const axios = require('axios');
const https = require('https');
const iconv = require('iconv-lite');
const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');
require('dotenv').config();

const USER_AGENT = process.env.SPIDER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const request = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false })
});

async function fetchWithRetry(fn, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i < retries) {
                await sleep(1000 * (i + 1));
            } else {
                throw error;
            }
        }
    }
}

function getTxCode(etfCode) {
    if (etfCode.startsWith('51') || etfCode.startsWith('56')) {
        return `sh${etfCode}`;
    }
    if (etfCode.startsWith('15') || etfCode.startsWith('16')) {
        return `sz${etfCode}`;
    }
    return `sh${etfCode}`;
}

async function fetchETFRealTimeQuote(etfCode) {
    return fetchWithRetry(async () => {
        const txCode = getTxCode(etfCode);
        const url = `https://qt.gtimg.cn/q=${txCode}`;
        const response = await request.get(url, { responseType: 'arraybuffer' });
        const text = iconv.decode(Buffer.from(response.data), 'GBK');
        if (!text || text.includes('FAILED')) return null;

        const match = text.match(/"(.*)"/);
        if (!match) return null;

        const parts = match[1].split('~');
        if (parts.length < 40) return null;

        return {
            code: etfCode,
            name: parts[1] || '',
            currentPrice: parseFloat(parts[3]) || 0,
            lastClose: parseFloat(parts[4]) || 0,
            openPrice: parseFloat(parts[5]) || 0,
            volume: parseInt(parts[6]) || 0,
            highPrice: parseFloat(parts[33]) || 0,
            lowPrice: parseFloat(parts[34]) || 0,
            changePct: parseFloat(parts[32]) || 0,
            amount: parseFloat(parts[37]) || 0,
        };
    }).catch(error => {
        logger.error(`获取ETF实时行情失败 [${etfCode}]: ${error.message}`);
        return null;
    });
}

async function fetchETFHistoryData(etfCode, startDate, endDate) {
    return fetchWithRetry(async () => {
        const txCode = getTxCode(etfCode);
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get`;
        const response = await request.get(url, {
            params: {
                param: `${txCode},day,${startDate},${endDate},2000,qfq`
            }
        });

        const result = [];
        if (response.data && response.data.data) {
            const stockData = response.data.data[txCode];
            if (!stockData) return result;

            const days = stockData.qfqday || stockData.day || [];
            for (const day of days) {
                if (day.length >= 6) {
                    result.push({
                        tradeDate: day[0],
                        openPrice: parseFloat(day[1]),
                        closePrice: parseFloat(day[2]),
                        highPrice: parseFloat(day[3]),
                        lowPrice: parseFloat(day[4]),
                        volume: parseInt(day[5]) || 0,
                        changePct: 0
                    });
                }
            }

            for (let i = 1; i < result.length; i++) {
                const prevClose = result[i - 1].closePrice;
                if (prevClose > 0) {
                    result[i].changePct = ((result[i].closePrice - prevClose) / prevClose) * 100;
                }
            }
        }
        return result;
    }).catch(error => {
        logger.error(`获取ETF历史数据失败 [${etfCode}]: ${error.message}`);
        return [];
    });
}

async function searchETF(keyword) {
    try {
        const url = `https://searchadapter.eastmoney.com/api/suggest/get`;
        const response = await request.get(url, {
            params: {
                input: keyword,
                type: 14,
                token: 'D43BF722C8E33BDC906FB84D85E326E8',
                count: 10
            }
        });
        if (response.data && response.data.data) {
            const etfs = response.data.data.filter(item =>
                item.Type === 'ETF' || /^(51|56|15)\d{4}$/.test(item.Code)
            );
            return etfs.map(item => ({
                code: item.Code,
                name: item.Name,
                type: 'ETF'
            }));
        }
        return [];
    } catch (error) {
        logger.error(`搜索ETF失败 [${keyword}]: ${error.message}`);
        return [];
    }
}

async function fetchETFList() {
    try {
        const codes = ['510050', '510300', '510500', '510880', '511010', '513100', '513500', '518880', '159915', '159949'];
        const results = [];
        for (const code of codes) {
            const quote = await fetchETFRealTimeQuote(code);
            if (quote) {
                results.push(quote);
            }
            await sleep(200);
        }
        return results;
    } catch (error) {
        logger.error(`获取ETF列表失败: ${error.message}`);
        return [];
    }
}

async function fetchHS300Index() {
    return fetchWithRetry(async () => {
        const url = `https://qt.gtimg.cn/q=sh000300`;
        const response = await request.get(url, { responseType: 'arraybuffer' });
        const text = iconv.decode(Buffer.from(response.data), 'GBK');
        const match = text.match(/"(.*)"/);
        if (!match) return null;
        const parts = match[1].split('~');
        return {
            code: '000300',
            name: '沪深300',
            currentPrice: parseFloat(parts[3]) || 0,
            changePct: parseFloat(parts[32]) || 0,
        };
    }).catch(error => {
        logger.error(`获取沪深300指数失败: ${error.message}`);
        return null;
    });
}

async function fetchHS300History(startDate, endDate) {
    return fetchWithRetry(async () => {
        const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline`;
        const response = await request.get(url, {
            params: { param: `sh000300,day,${startDate},${endDate},2000` }
        });
        const result = [];
        if (response.data && response.data.data) {
            const stockData = response.data.data.sh000300;
            if (stockData) {
                const days = stockData.day || [];
                for (const day of days) {
                    if (day.length >= 3) {
                        result.push({ tradeDate: day[0], closePrice: parseFloat(day[2]) });
                    }
                }
            }
        }
        return result;
    }).catch(error => {
        logger.error(`获取沪深300历史数据失败: ${error.message}`);
        return [];
    });
}

module.exports = {
    fetchETFRealTimeQuote,
    fetchETFHistoryData,
    searchETF,
    fetchETFList,
    fetchHS300Index,
    fetchHS300History
};
