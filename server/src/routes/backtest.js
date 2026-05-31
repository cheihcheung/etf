const express = require('express');
const router = express.Router();
const backtestService = require('../services/backtest');
const logger = require('../utils/logger');

router.post('/run', async (req, res) => {
  try {
    const params = req.body;
    const result = await backtestService.runBacktest(params);
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error(`单次回测失败: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
});

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

router.get('/results', async (req, res) => {
  try {
    const results = await backtestService.getBacktestResults();
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

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
