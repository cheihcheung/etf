/**
 * ==========================================================================================
 * 交易流水与市值查询接口路由 (/api/records)
 * ==========================================================================================
 * 提供交易流水的分页查询和实盘市值(占位)接口。
 *
 * 【接口清单】
 *   GET /trades?type=&startDate=&endDate=&page=&pageSize= : 分页交易流水
 *   GET /market : 实盘市值+沪深300基准(⚠️ 当前为占位实现，holdings 始终为空)
 * ==========================================================================================
 */
const express = require('express');
const router = express.Router();

// 导入 MVC 实体模型层
const TradeRecord = require('../models/TradeRecord');

/**
 * GET /trades - 分页查询交易流水记录
 *
 * 支持按交易类型、起止日期过滤，返回分页结果(按交易时间倒序)。
 * @query {string} [type] - 交易类型筛选：rebalance/strategy_a/strategy_b/manual
 * @query {string} [startDate] - 起始日期 'YYYY-MM-DD'
 * @query {string} [endDate] - 结束日期 'YYYY-MM-DD'
 * @query {number} [page=1] - 页码
 * @query {number} [pageSize=50] - 每页条数
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
 * GET /market - 实盘资产市值与沪深300基准
 *
 * ⚠️ [占位接口] 当前实现只返回沪深300实时基准，holdings 和 totalValue 始终为空/0。
 * 完整的实盘市值功能需要对接券商实盘持仓接口，属于待开发功能。
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
