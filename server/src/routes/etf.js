const express = require('express');
const router = express.Router();
const spider = require('../services/spider');
const logger = require('../utils/logger');

// 导入全新 MVC 模型层实体
const EtfBasic = require('../models/EtfBasic');
const EtfHistory = require('../models/EtfHistory');

/**
 * 辅助函数：根据起止日期以年份进行切片（用于历史行情抓取补全防超时）
 */
function splitYears(startDate, endDate) {
    const years = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    let year = start.getFullYear();
    while (true) {
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year + 1, 0, 1);
        const segStart = yearStart < start ? start : yearStart;
        const segEnd = yearEnd > end ? end : yearEnd;
        years.push({
            start: segStart.toISOString().slice(0, 10),
            end: segEnd.toISOString().slice(0, 10)
        });
        if (yearEnd >= end) break;
        year++;
    }
    return years;
}

/**
 * GET /list
 * 面向数据模型，优雅获取所有 ETF 列表及其已存历史行情时间起止点
 */
router.get('/list', async (req, res) => {
    try {
        // 完美调用模型层内聚的高级聚合查询方法，杜绝 routes 层裸写 JOIN GROUP BY 的潜在报错
        const etfs = await EtfBasic.getWithHistoryRange();
        res.json({ success: true, data: etfs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /add
 * 添加一只全新标的 ETF
 */
router.post('/add', async (req, res) => {
    try {
        const { code, name, assetType } = req.body;
        if (!code || !name || !assetType) {
            return res.status(400).json({ success: false, message: '请填写完整的ETF信息' });
        }
        
        // 使用 Model 查重
        const existing = await EtfBasic.findOne({ code });
        if (existing) {
            return res.status(400).json({ success: false, message: '该ETF已存在' });
        }
        
        // 使用 Model 一键创建
        await EtfBasic.create({
            code,
            name,
            asset_type: assetType,
            initial_ratio: 0.0000
        });
        
        // 抓取实时行情并利用 Model 快速同步
        const quote = await spider.fetchETFRealTimeQuote(code);
        if (quote) {
            await EtfBasic.syncPrice(code, quote.currentPrice, quote.changePct);
        }
        
        logger.info(`添加ETF: ${code} ${name}`);
        res.json({ success: true, message: '添加成功' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /update
 * 编辑和更新已有标的 ETF 的基础元数据
 */
router.put('/update', async (req, res) => {
    try {
        const { code, name, assetType, initialRatio } = req.body;
        
        // 利用 Model 进行条件更新，消灭 Raw SQL
        await EtfBasic.updateWhere({ code }, [], {
            name: name,
            asset_type: assetType,
            initial_ratio: initialRatio !== undefined ? parseFloat(initialRatio) : 0.0000
        });
        res.json({ success: true, message: '更新成功' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /delete/:code
 * 物理卸载删除某标的 ETF，安全折算配比
 */
router.delete('/delete/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        // 核心适配：直接从 EtfBasic 模型中查询该 ETF 现在的占比
        const ratioCheck = await EtfBasic.findOne({ code });
        if (ratioCheck && parseFloat(ratioCheck.initial_ratio) > 0) {
            // 计算剔除当前标的后，其他标的的累计占比
            const allEtfs = await EtfBasic.findAll();
            const otherTotal = allEtfs
                .filter(e => e.code !== code)
                .reduce((sum, e) => sum + parseFloat(e.initial_ratio || 0), 0);

            if (Math.abs(otherTotal - 100) > 0.01 && otherTotal > 0) {
                return res.status(400).json({ success: false, message: '删除该ETF会导致其他ETF总占比不为100%，请先调整比例' });
            }
        }
        
        // 利用 Model 清除标的基础数据即可，回测持仓在内存中虚拟维护
        await EtfBasic.deleteWhere({ code });
        
        logger.info(`删除ETF: ${code}`);
        res.json({ success: true, message: '删除成功' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /quote/:code
 * 快速同步单只 ETF 实时价格涨幅
 */
router.get('/quote/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const quote = await spider.fetchETFRealTimeQuote(code);
        if (quote) {
            await EtfBasic.syncPrice(code, quote.currentPrice, quote.changePct);
        }
        res.json({ success: true, data: quote });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /search
 * 联机实时检索大盘行情标的代码
 */
router.get('/search', async (req, res) => {
    try {
        const { keyword } = req.query;
        if (!keyword) {
            return res.status(400).json({ success: false, message: '请输入搜索关键词' });
        }
        const results = await spider.searchETF(keyword);
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /sync-all
 * 实盘状态下一键同步全量 ETF 的实时报价，并自动查漏补缺最近历史行情K线
 */
router.post('/sync-all', async (req, res) => {
    try {
        const etfs = await EtfBasic.findAll();
        let successCount = 0;
        let historySyncedCount = 0;
        const today = new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

        for (const etf of etfs) {
            // 1. 同步最新实时报价
            const quote = await spider.fetchETFRealTimeQuote(etf.code);
            if (quote) {
                await EtfBasic.syncPrice(etf.code, quote.currentPrice, quote.changePct);
                successCount++;
            }

            // 2. 面向 EtfHistory 模型层判断是否缺漏近期历史 K 线数据，进行自动防超时补齐
            const lastDate = await EtfHistory.getLastRecordDate(etf.code);
            if (lastDate) {
                const lastDateObj = new Date(lastDate);
                const nextDay = new Date(lastDateObj.getTime() + 24 * 3600 * 1000);
                const startDate = nextDay.toISOString().slice(0, 10);
                
                if (startDate <= today) {
                    const missingData = await spider.fetchETFHistoryData(etf.code, startDate, today);
                    if (missingData && missingData.length > 0) {
                        for (const row of missingData) {
                            // 利用 Model 一键安全保存行情
                            const existingK = await EtfHistory.findOne({
                                etf_code: etf.code,
                                trade_date: row.tradeDate
                            });
                            if (existingK) {
                                await EtfHistory.update(existingK.id, {
                                    close_price: row.closePrice
                                });
                            } else {
                                await EtfHistory.create({
                                    etf_code: etf.code,
                                    trade_date: row.tradeDate,
                                    open_price: row.openPrice,
                                    close_price: row.closePrice,
                                    high_price: row.highPrice,
                                    low_price: row.lowPrice,
                                    volume: row.volume,
                                    change_pct: row.changePct
                                });
                            }
                        }
                        historySyncedCount += missingData.length;
                        logger.info(`自动补全历史 [${etf.code} ${etf.name}]: ${missingData.length}条`);
                    }
                }
            }
        }
        res.json({ success: true, message: `同步完成：${successCount}只ETF实时价格已更新，自动补全了${historySyncedCount}条历史数据` });
    } catch (error) {
        logger.error(`同步行情失败: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /history/:code
 * 面向行情历史模型，查询获取特定标的的历史 K 线全序列，若无本地则穿透到爬虫抓取
 */
router.get('/history/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: '请选择起止日期' });
        }
        
        // 完美调用 EtfHistory 模型层方法获取本地缓存，剥离裸写 SQL
        const dbData = await EtfHistory.getHistoryByRange(code, startDate, endDate);
        if (dbData.length > 0) {
            const data = dbData.map((r) => {
                let tradeDate;
                if (typeof r.trade_date === 'string') {
                    tradeDate = r.trade_date;
                } else {
                    const d = new Date(r.trade_date);
                    tradeDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                }
                return {
                    tradeDate,
                    openPrice: parseFloat(r.open_price),
                    closePrice: parseFloat(r.close_price),
                    highPrice: parseFloat(r.high_price),
                    lowPrice: parseFloat(r.low_price),
                    volume: parseInt(r.volume),
                    changePct: parseFloat(r.change_pct)
                };
            });
            return res.json({ success: true, data, source: 'db' });
        }
        
        // 本地无缓存，自动抓取爬虫接口并返回
        const data = await spider.fetchETFHistoryData(code, startDate, endDate);
        res.json({ success: true, data, source: 'spider' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /sync-history
 * 密集批量强制同步指定标的的大段历史行情 K 线走势并安全落盘 (支持年份切片)
 */
router.post('/sync-history', async (req, res) => {
    try {
        const { startDate, endDate, codes } = req.body;
        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: '请选择起止日期' });
        }
        
        let etfs;
        if (codes && codes.length > 0) {
            // 模型化批量获取
            etfs = await EtfBasic.findAll(`code IN (${codes.map(() => '?').join(', ')})`, codes);
        } else {
            etfs = await EtfBasic.findAll();
        }
        
        if (etfs.length === 0) {
            return res.status(400).json({ success: false, message: '未找到匹配的ETF数据，请先添加ETF' });
        }
        
        let totalCount = 0;
        const segments = splitYears(startDate, endDate);
        for (const etf of etfs) {
            for (const seg of segments) {
                const data = await spider.fetchETFHistoryData(etf.code, seg.start, seg.end);
                if (data.length > 0) {
                    for (const row of data) {
                        // 使用 Model 查询及一键双向存储，消灭原繁杂 ON DUPLICATE KEY UPDATE 语句
                        const existingK = await EtfHistory.findOne({
                            etf_code: etf.code,
                            trade_date: row.tradeDate
                        });
                        
                        if (existingK) {
                            await EtfHistory.update(existingK.id, {
                                open_price: row.openPrice,
                                close_price: row.closePrice,
                                high_price: row.highPrice,
                                low_price: row.lowPrice,
                                volume: row.volume,
                                change_pct: row.changePct
                            });
                        } else {
                            await EtfHistory.create({
                                etf_code: etf.code,
                                trade_date: row.tradeDate,
                                open_price: row.openPrice,
                                close_price: row.closePrice,
                                high_price: row.highPrice,
                                low_price: row.lowPrice,
                                volume: row.volume,
                                change_pct: row.changePct
                            });
                        }
                    }
                    totalCount += data.length;
                }
            }
            logger.info(`历史数据同步 [${etf.code} ${etf.name}]: ${totalCount}条`);
        }
        logger.info(`历史数据同步完成，共${totalCount}条`);
        res.json({ success: true, message: `历史数据同步完成，共${totalCount}条` });
    } catch (error) {
        logger.error(`历史数据同步失败: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /market-list
 * 检索抓取网易/东方财富的全盘ETF配置市场最新名录
 */
router.get('/market-list', async (req, res) => {
    try {
        const list = await spider.fetchETFList();
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
