/**
 * ==========================================================================================
 * ETF 行情数据爬虫模块（desktop 独立版）
 * ==========================================================================================
 * 负责从腾讯(qt.gtimg.cn / web.ifzq.gtimg.cn)和东方财富(searchadapter.eastmoney.com)
 * 抓取 ETF/指数的实时报价和历史K线数据。
 *
 * 【数据源说明】
 *   1. 实时报价：腾讯 qt.gtimg.cn 接口，返回 GBK 编码文本，需 iconv-lite 解码
 *   2. 历史K线：腾讯 web.ifzq.gtimg.cn 的 fqkline 接口，返回 JSON，支持前复权(qfq)
 *   3. ETF搜索：东方财富 searchadapter 接口，返回 JSON
 *
 * 【设计原则】
 *   本模块为纯逻辑模块，不依赖任何数据库或日志框架。
 *   错误处理：通过 fetchWithRetry 重试后将 axios 错误转为普通 Error 抛出，
 *   由调用方（desktop/ipc-handlers.js）负责捕获和记录。
 * ==========================================================================================
 */
const axios = require('axios');
const https = require('https');
const iconv = require('iconv-lite');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const request = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(fn, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i < retries) {
                await sleep(1000 * (i + 1));
            } else {
                const msg = error.response
                    ? `HTTP ${error.response.status}: ${error.response.statusText || ''}`
                    : (error.code || error.message || String(error));
                throw new Error(msg);
            }
        }
    }
}

function getTxCode(etfCode) {
    if (etfCode.startsWith('1B') || etfCode.startsWith('1b')) {
        const numPart = etfCode.substring(2);
        return `sh${numPart.padStart(6, '0')}`;
    }
    if (etfCode.startsWith('51') || etfCode.startsWith('56')) {
        return `sh${etfCode}`;
    }
    if (etfCode.startsWith('15') || etfCode.startsWith('16')) {
        return `sz${etfCode}`;
    }
    return `sh${etfCode}`;
}

async function fetchETFRealTimeQuote(etfCode) {
    return await fetchWithRetry(async () => {
        const txCode = getTxCode(etfCode);
        const url = `https://qt.gtimg.cn/q=${txCode}`;
        const response = await request.get(url, { responseType: 'arraybuffer' });

        const buffer = Buffer.from(response.data);
        const text = iconv.decode(buffer, 'GBK');

        const match = text.match(/v_[^=]+=~*(.+)/);
        if (!match) return null;

        const fields = match[1].split('~');
        if (fields.length < 4) return null;

        return {
            code: String(etfCode),
            name: String(fields[1]),
            currentPrice: parseFloat(fields[3]),
            lastClose: parseFloat(fields[4]) || 0,
            openPrice: parseFloat(fields[5]) || 0,
            volume: parseInt(fields[6]) || 0,
            highPrice: parseFloat(fields[33]) || 0,
            lowPrice: parseFloat(fields[34]) || 0,
            changePct: parseFloat(fields[32] || 0),
            amount: parseFloat(fields[37]) || 0,
        };
    });
}

function parseKlines(klines, startDate, endDate) {
    const result = [];
    for (const kline of klines) {
        const [date, open, close, high, low, volume] = kline;
        if (date >= startDate && date <= endDate) {
            result.push({
                tradeDate: String(date),
                openPrice: parseFloat(open),
                closePrice: parseFloat(close),
                highPrice: parseFloat(high),
                lowPrice: parseFloat(low),
                volume: parseInt(volume),
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
    return result;
}

async function fetchETFHistoryData(etfCode, startDate, endDate) {
    return await fetchWithRetry(async () => {
        const txCode = getTxCode(etfCode);
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${txCode},day,${startDate},${endDate},800,qfq`;
        const response = await request.get(url);
        const data = response.data;

        if (!data || data.code !== 0 || !data.data) {
            return [];
        }

        const stockData = data.data[txCode];
        if (!stockData) return [];

        const klines = stockData.qfqday || stockData.day || stockData.hfqday;
        if (!klines || klines.length === 0) return [];

        return parseKlines(klines, startDate, endDate);
    });
}

async function searchETF(keyword) {
    return await fetchWithRetry(async () => {
        const url = `https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14`;
        const response = await request.get(url);
        const data = response.data;

        if (!data || !data.QuotationCodeTable) return [];

        return data.QuotationCodeTable.Data.map(item => ({
            code: String(item.Code),
            name: String(item.Name),
            type: String(item.TypeName)
        }));
    });
}

async function fetchETFList() {
    return [
        { code: '510300', name: '沪深300ETF', type: '股票类' },
        { code: '510500', name: '中证500ETF', type: '股票类' },
        { code: '159915', name: '创业板ETF', type: '股票类' },
        { code: '511260', name: '国债ETF', type: '债券类' },
        { code: '518880', name: '黄金ETF', type: '黄金类' }
    ];
}

async function fetchHS300Index() {
    return await fetchETFRealTimeQuote('000300');
}

function getEastMoneySecid(etfCode) {
    if (etfCode.startsWith('1B') || etfCode.startsWith('1b')) {
        const numPart = etfCode.substring(2);
        return `1.${numPart.padStart(6, '0')}`;
    }
    if (etfCode.startsWith('15') || etfCode.startsWith('16') || etfCode.startsWith('18') || etfCode.startsWith('39')) {
        return `0.${etfCode}`;
    }
    return `1.${etfCode}`;
}

async function fetchETFHistoryDataEastMoney(etfCode, startDate, endDate) {
    return await fetchWithRetry(async () => {
        const secid = getEastMoneySecid(etfCode);
        const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
        const formattedEndDate = endDate.replace(/-/g, '');
        const response = await request.get(url, {
            params: {
                secid: secid,
                fields1: 'f1,f2,f3,f4,f5,f6',
                fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
                klt: 101,
                fqt: 1,
                end: formattedEndDate,
                lmt: 10000,
            },
            headers: {
                Referer: 'https://quote.eastmoney.com/'
            }
        });

        const result = [];
        if (response.data && response.data.data && response.data.data.klines) {
            const klines = response.data.data.klines;
            for (const line of klines) {
                const parts = line.split(',');
                if (parts.length >= 9) {
                    const tradeDate = parts[0];
                    if (tradeDate >= startDate && tradeDate <= endDate) {
                        result.push({
                            tradeDate: tradeDate,
                            openPrice: parseFloat(parts[1]),
                            closePrice: parseFloat(parts[2]),
                            highPrice: parseFloat(parts[3]),
                            lowPrice: parseFloat(parts[4]),
                            volume: parseInt(parts[5]) || 0,
                            changePct: parseFloat(parts[8]) || 0,
                        });
                    }
                }
            }
        }
        return result;
    });
}

module.exports = {
    fetchETFRealTimeQuote,
    fetchETFHistoryData,
    fetchETFHistoryDataEastMoney,
    searchETF,
    fetchETFList,
    fetchHS300Index,
    getTxCode,
    getEastMoneySecid
};
