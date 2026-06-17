/**
 * ==========================================================================================
 * 回测相关接口路由 (/api/backtest)
 * ==========================================================================================
 * 提供回测执行、参数寻优、结果查询的 HTTP 接口。
 *
 * 【接口清单】
 *   POST /run          : 执行单次组合回测
 *   POST /optimize     : 执行参数网格寻优(笛卡尔积遍历)
 *   GET  /results      : 获取回测结果排行榜(精简列表)
 *   GET  /results/:id  : 获取单次回测完整详情(含 daily_detail)
 * ==========================================================================================
 */
const express = require('express');
const router = express.Router();
const backtestService = require('../services/backtest');
const logger = require('../utils/logger');

/**
 * POST /run - 执行单次组合回测
 * 请求体：回测参数对象(详见 services/backtest.js 的 runBacktest 函数文档)
 * 返回：完整回测结果，含 totalReturn/annualReturn/maxDrawdown/dailyValues 等
 */
router.post('/run', async (req, res) => {
  try {
    const params = req.body;
    const result = await backtestService.runBacktest(params);
    if (result.error) {
      // 回测引擎返回的业务错误(如无历史数据)
      return res.status(400).json({ success: false, message: result.error });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error(`单次回测失败: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /optimize - 执行参数网格寻优
 * 请求体：{ baseParams, optimizationRanges }
 *   - baseParams      : 基础回测参数(所有组合共享)
 *   - optimizationRanges : 待遍历的参数维度，如 {rebalanceThreshold:[1,2,3]}
 * 返回：{ totalCombinations, sortedResults(前50), bestParams }
 * 注意：寻优可能耗时较长(几百次回测)，建议设置合理的超时时间
 */
router.post('/optimize', async (req, res) => {
  try {
    const params = req.body;
    const result = await backtestService.runParameterOptimization(params);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error(`参数寻优失败: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /results - 获取回测结果排行榜
 * 返回精简列表(剔除 daily_detail 大字段)，按创建时间倒序，最多500条
 */
router.get('/results', async (req, res) => {
  try {
    const results = await backtestService.getBacktestResults();
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /results/:id - 获取单次回测完整详情
 * 返回包含 daily_detail 大字段(每日净值/现金流/持仓等完整序列)
 */
router.get('/results/:id', async (req, res) => {
  try {
    const detail = await backtestService.getBacktestDetail(req.params.id);
    if (!detail) {
      return res.status(404).json({ success: false, message: '回测结果不存在' });
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
