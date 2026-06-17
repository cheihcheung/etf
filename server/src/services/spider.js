/**
 * ==========================================================================================
 * ETF 行情数据爬虫模块
 * ==========================================================================================
 * 负责从腾讯(qt.gtimg.cn / web.ifzq.gtimg.cn)和东方财富(searchadapter.eastmoney.com)
 * 抓取 ETF/指数的实时报价和历史K线数据，作为本地 history_data 表的数据源。
 *
 * 【数据源说明】
 *   1. 实时报价：腾讯 qt.gtimg.cn 接口，返回 GBK 编码文本，需 iconv-lite 解码
 *      格式：v_sh510300="1~沪深300ETF~510300~3.52~..." 用 ~ 分隔字段
 *   2. 历史K线：腾讯 web.ifzq.gtimg.cn 的 fqkline 接口，返回 JSON，支持前复权(qfq)
 *   3. ETF搜索：东方财富 searchadapter 接口，返回 JSON
 *
 * 【交易所代码前缀映射】
 *   - 51/56 开头 → 上海证券交易所(sh)，如 510300(沪深300ETF)
 *   - 15/16 开头 → 深圳证券交易所(sz)，如 159915(创业板ETF)
 *
 * 【限流与重试】
 *   - 每次 HTTP 请求间隔 200ms(sleep)，避免被风控封禁
 *   - fetchWithRetry 提供最多 2 次重试，指数退避(1s, 2s)
 *
 * 【导出方法】
 *   - fetchETFRealTimeQuote : 单只ETF实时报价
 *   - fetchETFHistoryData   : 单只ETF历史日K线(前复权)
 *   - searchETF             : 按关键字搜索ETF代码(东财)
 *   - fetchETFList          : 批量获取预设ETF列表实时报价
 *   - fetchHS300Index       : 沪深300指数实时报价
 *   - fetchHS300History     : 沪深300指数历史日K线
 * ==========================================================================================
 */
const axios = require('axios');
const https = require('https');
const iconv = require('iconv-lite');
const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');
require('dotenv').config();

// 爬虫请求头：伪装浏览器 UA，避免被识别为机器人
const USER_AGENT = process.env.SPIDER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// axios 实例：统一配置超时、请求头、HTTPS keepAlive
// rejectUnauthorized:false 忽略 HTTPS 证书校验(部分行情接口证书不标准)
const request = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false })
});

/**
 * 带重试的请求封装(指数退避)
 * @param {Function} fn - 实际执行请求的异步函数
 * @param {number} retries - 最大重试次数(默认2次，共3次尝试)
 * @returns {Promise<any>} fn 的返回值
 */
async function fetchWithRetry(fn, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i < retries) {
                // 指数退避：第1次重试等1s，第2次等2s
                await sleep(1000 * (i + 1));
            } else {
                throw error;
            }
        }
    }
}

/**
 * 将 ETF 代码转换为腾讯接口所需的带交易所前缀代码
 *
 * 腾讯接口要求代码前缀交易所标识：
 *   - 51/56 开头(沪市ETF) → sh + 代码，如 510300 → sh510300
 *   - 15/16 开头(深市ETF) → sz + 代码，如 159915 → sz159915
 *   - 其他默认按沪市处理
 *
 * @param {string} etfCode - 6位ETF代码，如 '510300'
 * @returns {string} 带前缀的代码，如 'sh510300'
 */
function getTxCode(etfCode) {
    if (etfCode.startsWith('51') || etfCode.startsWith('56')) {
        return `sh${etfCode}`;
    }
    if (etfCode.startsWith('15') || etfCode.startsWith('16')) {
        return `sz${etfCode}`;
    }
    return `sh${etfCode}`;
}

/**
 * 获取单只 ETF 的实时行情报价
 *
 * 【接口】https://qt.gtimg.cn/q=sh510300
 * 【编码】返回 GBK 编码，需 iconv-lite 解码为 UTF-8
 * 【格式】v_sh510300="1~名称~代码~当前价~昨收~开盘~成交量~...~涨跌幅~..."
 *        用 ~ 分隔的字符串，各字段位置固定。
 *
 * @param {string} etfCode - 6位ETF代码
 * @returns {Promise<Object|null>} 行情对象 {code,name,currentPrice,...} 或 null
 */
async function fetchETFRealTimeQuote(etfCode) {
    return fetchWithRetry(async () => {
        const txCode = getTxCode(etfCode);
        const url = `https://qt.gtimg.cn/q=${txCode}`;
        // responseType:'arraybuffer' 先拿原始字节，再用 iconv 按 GBK 解码(腾讯接口返回GBK)
        const response = await request.get(url, { responseType: 'arraybuffer' });
        const text = iconv.decode(Buffer.from(response.data), 'GBK');
        if (!text || text.includes('FAILED')) return null;

        // 提取双引号内的字段串
        const match = text.match(/"(.*)"/);
        if (!match) return null;

        // 按 ~ 分隔，腾讯接口字段位置是固定的
        const parts = match[1].split('~');
        if (parts.length < 40) return null;

        return {
            code: etfCode,
            name: parts[1] || '',                    // [1] 名称
            currentPrice: parseFloat(parts[3]) || 0, // [3] 当前价
            lastClose: parseFloat(parts[4]) || 0,    // [4] 昨收价
            openPrice: parseFloat(parts[5]) || 0,    // [5] 今开价
            volume: parseInt(parts[6]) || 0,         // [6] 成交量
            highPrice: parseFloat(parts[33]) || 0,   // [33] 最高价
            lowPrice: parseFloat(parts[34]) || 0,    // [34] 最低价
            changePct: parseFloat(parts[32]) || 0,   // [32] 涨跌幅%
            amount: parseFloat(parts[37]) || 0,      // [37] 成交额
        };
    }).catch(error => {
        logger.error(`获取ETF实时行情失败 [${etfCode}]: ${error.message}`);
        return null;
    });
}

/**
 * 获取单只 ETF 的历史日K线数据(前复权)
 *
 * 【接口】https://web.ifzq.gtimg.cn/appstock/app/fqkline/get
 * 【参数】param=代码,day,起始日,结束日,最大条数,qfq
 *   - qfq = 前复权(把历史价格按分红除权向前调整，保证价格连续性)
 * 【返回】JSON，data[txCode].qfqday 或 .day 数组，每条 [日期,开,收,高,低,量]
 *
 * ⚠️ 注意：返回的涨跌幅(changePct)接口未提供，这里根据前后日收盘价自行计算。
 *
 * @param {string} etfCode - 6位ETF代码
 * @param {string} startDate - 起始日期 'YYYY-MM-DD'
 * @param {string} endDate - 结束日期 'YYYY-MM-DD'
 * @returns {Promise<Array>} K线数组 [{tradeDate,openPrice,closePrice,highPrice,lowPrice,volume,changePct}]
 */
async function fetchETFHistoryData(etfCode, startDate, endDate) {
    return fetchWithRetry(async () => {
        const txCode = getTxCode(etfCode);
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get`;
        const response = await request.get(url, {
            params: {
                // param 格式：代码,周期(day/dayweek/month),起始,结束,最大条数,复权类型(qfq前复权)
                param: `${txCode},day,${startDate},${endDate},2000,qfq`
            }
        });

        const result = [];
        if (response.data && response.data.data) {
            const stockData = response.data.data[txCode];
            if (!stockData) return result;

            // 前复权数据在 qfqday 字段，无复权在 day 字段
            const days = stockData.qfqday || stockData.day || [];
            for (const day of days) {
                // 每条格式：[日期, 开盘, 收盘, 最高, 最低, 成交量]
                if (day.length >= 6) {
                    result.push({
                        tradeDate: day[0],
                        openPrice: parseFloat(day[1]),
                        closePrice: parseFloat(day[2]),
                        highPrice: parseFloat(day[3]),
                        lowPrice: parseFloat(day[4]),
                        volume: parseInt(day[5]) || 0,
                        changePct: 0 // 接口未返回，下面自行计算
                    });
                }
            }

            // 根据前后日收盘价计算涨跌幅(首条无法计算，保持0)
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

/**
 * 按关键字搜索 ETF(使用东方财富搜索接口)
 *
 * 【接口】https://searchadapter.eastmoney.com/api/suggest/get
 * 【过滤】只保留 Type==='ETF' 或代码符合 51/56/15 开头规则的标的
 *
 * @param {string} keyword - 搜索关键字(代码或名称)
 * @returns {Promise<Array>} 匹配结果 [{code,name,type}]
 */
async function searchETF(keyword) {
    try {
        const url = `https://searchadapter.eastmoney.com/api/suggest/get`;
        const response = await request.get(url, {
            params: {
                input: keyword,
                type: 14,
                token: 'D43BF722C8E33BDC906FB84D85E326E8', // 东财公开token
                count: 10
            }
        });
        if (response.data && response.data.data) {
            // 过滤：只保留ETF类型，或代码符合沪/深市ETF规则的标的
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

/**
 * 批量获取预设的常见ETF列表实时报价
 * 内置10只主流ETF代码，逐个请求并限流(每次间隔200ms)。
 * @returns {Promise<Array>} 行情数组
 */
async function fetchETFList() {
    try {
        const codes = ['510050', '510300', '510500', '510880', '511010', '513100', '513500', '518880', '159915', '159949'];
        const results = [];
        for (const code of codes) {
            const quote = await fetchETFRealTimeQuote(code);
            if (quote) {
                results.push(quote);
            }
            await sleep(200); // 限流：每次请求间隔200ms
        }
        return results;
    } catch (error) {
        logger.error(`获取ETF列表失败: ${error.message}`);
        return [];
    }
}

/**
 * 获取沪深300指数(000300)的实时报价
 * 与 fetchETFRealTimeQuote 类似，但代码固定为 sh000300(指数)。
 * @returns {Promise<Object|null>} {code,name,currentPrice,changePct}
 */
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

/**
 * 获取沪深300指数(000300)的历史日K线数据
 *
 * 【接口】https://web.ifzq.gtimg.cn/appstock/app/kline/kline
 * 注意：与ETF的 fqkline 接口不同，指数用 kline 接口(无复权概念)。
 *
 * @param {string} startDate - 起始日期
 * @param {string} endDate - 结束日期
 * @returns {Promise<Array>} [{tradeDate,closePrice}] 只返回日期和收盘价
 */
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
                    // 指数只需日期和收盘价(基准对比用)
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
