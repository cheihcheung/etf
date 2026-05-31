const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// 导入 MVC 数据模型层 (已物理删去 GlobalConfig 模型)
const EtfBasic = require('../models/EtfBasic');
const StrategyAConfig = require('../models/StrategyAConfig');
const StrategyBConfig = require('../models/StrategyBConfig');

/**
 * GET /initial-ratios
 * 获取当前所有配置的 ETF 初始配比
 */
router.get('/initial-ratios', async (req, res) => {
    try {
        const etfs = await EtfBasic.findAll();
        const ratios = etfs.map(e => ({
            etfCode: e.code,
            name: e.name,
            ratio: parseFloat(e.initial_ratio || 0),
            isEnabled: e.is_enabled === null || e.is_enabled === undefined || e.is_enabled !== 0,
            stepRatio: parseFloat(e.step_ratio !== null && e.step_ratio !== undefined ? e.step_ratio : 5.0)
        }));
        res.json({ success: true, data: ratios });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /initial-ratios
 * 更新各 ETF 的初始占比分配 (总和不能超100%)
 */
router.put('/initial-ratios', async (req, res) => {
    try {
        const { ratios } = req.body;
        if (!ratios || ratios.length === 0) {
            return res.status(400).json({ success: false, message: '请配置ETF比例' });
        }
        // 仅对启用的 ETF 计算初始总占比是否超标！
        const activeTotal = ratios
            .filter(r => r.isEnabled !== false)
            .reduce((sum, r) => sum + parseFloat(r.ratio || 0), 0);
            
        if (activeTotal > 100.01) {
            return res.status(400).json({ success: false, message: `当前启用的资产总占比为${activeTotal.toFixed(2)}%，不能超过100%` });
        }
        
        await EtfBasic.updateWhere('1 = 1', [], { initial_ratio: 0.0000 });
        for (const r of ratios) {
            await EtfBasic.updateRatio(r.etfCode, r.isEnabled ? parseFloat(r.ratio) : 0);
            await EtfBasic.updateWhere({ code: r.etfCode }, [], {
                is_enabled: r.isEnabled ? 1 : 0,
                step_ratio: parseFloat(r.stepRatio || 5.0)
            });
        }
        
        logger.info('初始比例配置已更新');
        res.json({ success: true, message: '比例保存成功' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// JSON比率转换助手
const formatRatios = (ratiosJson) => {
    const parsed = typeof ratiosJson === 'string' ? JSON.parse(ratiosJson) : (ratiosJson || {});
    return Object.keys(parsed).map(code => ({
        etfCode: code,
        targetRatio: parseFloat(parsed[code])
    }));
};

const parseToDbRatios = (ratiosArr) => {
    const ratiosObj = {};
    (ratiosArr || []).forEach(r => {
        ratiosObj[r.etfCode] = parseFloat(r.targetRatio || 0);
    });
    return JSON.stringify(ratiosObj);
};

/**
 * GET /strategy-a
 * 获取策略 A 双向动态加减仓档位配置
 */
router.get('/strategy-a', async (req, res) => {
    try {
        const levels = await StrategyAConfig.findAll(null, [], 'level_order ASC');
        
        const drawdownLevels = levels
            .filter(l => l.trigger_type === 'drawdown')
            .map(l => ({
                levelOrder: l.level_order,
                threshold: parseFloat(l.threshold),
                ratios: formatRatios(l.ratios)
            }));
            
        const rallyLevels = levels
            .filter(l => l.trigger_type === 'rally')
            .map(l => ({
                levelOrder: l.level_order,
                threshold: parseFloat(l.threshold),
                ratios: formatRatios(l.ratios)
            }));

        res.json({
            success: true,
            data: {
                enabled: true,
                resetOnHigh: true,
                drawdownLevels,
                rallyLevels
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /strategy-a
 * 保存策略 A 档位与目标比例配置
 */
router.put('/strategy-a', async (req, res) => {
    try {
        const { drawdownLevels, rallyLevels } = req.body;
        
        const db = require('../config/db');
        await db.transaction(async () => {
            await StrategyAConfig.deleteWhere('1 = 1');
            for (const l of (drawdownLevels || [])) {
                await StrategyAConfig.create({
                    trigger_type: 'drawdown',
                    level_order: l.levelOrder,
                    threshold: parseFloat(l.threshold),
                    ratios: parseToDbRatios(l.ratios)
                });
            }
            for (const l of (rallyLevels || [])) {
                await StrategyAConfig.create({
                    trigger_type: 'rally',
                    level_order: l.levelOrder,
                    threshold: parseFloat(l.threshold),
                    ratios: parseToDbRatios(l.ratios)
                });
            }
        });

        res.json({ success: true, message: '策略A配置保存成功' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /strategy-b
 * 获取策略 B 中枢偏离档位配置
 */
router.get('/strategy-b', async (req, res) => {
    try {
        const levels = await StrategyBConfig.findAll(null, [], 'level_order ASC');
        
        const overvaluedLevels = levels
            .filter(l => l.deviation_type === 'overvalued')
            .map(l => ({
                levelOrder: l.level_order,
                threshold: parseFloat(l.threshold),
                ratios: formatRatios(l.ratios)
            }));
            
        const undervaluedLevels = levels
            .filter(l => l.deviation_type === 'undervalued')
            .map(l => ({
                levelOrder: l.level_order,
                threshold: parseFloat(l.threshold),
                ratios: formatRatios(l.ratios)
            }));

        res.json({
            success: true,
            data: {
                enabled: true,
                centralAnnual: 10.0,
                overvaluedLevels,
                undervaluedLevels
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /strategy-b
 * 保存策略 B 偏离中枢配置参数
 */
router.put('/strategy-b', async (req, res) => {
    try {
        const { overvaluedLevels, undervaluedLevels } = req.body;
        
        const db = require('../config/db');
        await db.transaction(async () => {
            await StrategyBConfig.deleteWhere('1 = 1');
            for (const l of (overvaluedLevels || [])) {
                await StrategyBConfig.create({
                    deviation_type: 'overvalued',
                    level_order: l.levelOrder,
                    threshold: parseFloat(l.threshold),
                    ratios: parseToDbRatios(l.ratios)
                });
            }
            for (const l of (undervaluedLevels || [])) {
                await StrategyBConfig.create({
                    deviation_type: 'undervalued',
                    level_order: l.levelOrder,
                    threshold: parseFloat(l.threshold),
                    ratios: parseToDbRatios(l.ratios)
                });
            }
        });

        res.json({ success: true, message: '策略B配置保存成功' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /etf-types
 * 获取系统中当前激活的资产分类类型列表
 */
router.get('/etf-types', async (req, res) => {
    try {
        const etfs = await EtfBasic.findAll();
        const existingTypes = etfs.map(e => e.asset_type).filter(Boolean);
        const defaultTypes = ['股票类', '债券类', '红利类', '商品类', '黄金类'];
        const allTypes = [...new Set([...defaultTypes, ...existingTypes])];
        res.json({ success: true, data: allTypes });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
