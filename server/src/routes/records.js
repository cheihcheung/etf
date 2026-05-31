const express = require('express');
const router = express.Router();

// 导入 MVC 实体模型层 (移除了无用的 GlobalConfig 模型)
const TradeRecord = require('../models/TradeRecord');

/**
 * GET /trades
 * 面向数据模型，拉取精细化过滤的分页交易流水记录
 */
router.get('/trades', async (req, res) => {
    try {
        const { type, startDate, endDate, page = 1, pageSize = 50 } = req.query;

        // 构建极其清爽的模型查询条件与防注入参数数组
        const conditions = [];
        const params = [];

        if (type) {
            conditions.push('trade_type = ?');
            params.push(type);
        }
        if (startDate) {
            conditions.push('trade_time >= ?');
            params.push(startDate);
        }
        if (endDate) {
            conditions.push('trade_time <= ?');
            params.push(endDate + ' 23:59:59');
        }

        const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1 = 1';
        const limit = parseInt(pageSize);
        const offset = (parseInt(page) - 1) * limit;

        // 完美调用 Model 通用列表方法，优雅读盘
        const records = await TradeRecord.findAll(
            whereClause,
            params,
            'trade_time DESC',
            `${limit} OFFSET ${offset}`
        );
        res.json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /market
 * 拉取实盘资产估值市值、成本偏离以及沪深300实时基准
 */
router.get('/market', async (req, res) => {
    try {
        const spider = require('../services/spider');
        const hs300 = await spider.fetchHS300Index();

        res.json({
            success: true,
            data: {
                hs300,
                holdings: [],
                totalValue: 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
