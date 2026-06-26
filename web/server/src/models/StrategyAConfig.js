/**
 * ==========================================================
 * ETF多资产动态配置策略系统 - 策略A双向动态配置档位参数模型 (StrategyAConfig Model)
 * ==========================================================
 * 映射物理表：strategy_a_config
 * 承载策略 A 的判定档位、回撤反弹阈值及配比 JSON，提供扁平化读取与一键保存。
 *
 * 【表结构关键字段】
 *   - trigger_type : 触发类型 enum('drawdown','rally') —— drawdown=回撤加仓档，rally=反弹减仓档
 *   - level_order  : 档位序号(1,2,3...)，数字越大档位越深
 *   - threshold    : 触发阈值(回撤百分比，如 10 表示回撤10%触发该档)
 *   - ratios       : 该档的目标配比 JSON，格式 {etfCode: 倍数}
 *
 * ⚠️ 【ratios 倍数语义(重要)】
 *   ratios 中存的是「倍数」而非实际占比！回测引擎 evaluateStrategyA 会按倍数模型换算：
 *     实际目标占比 = initialRatio[etfCode] + ratios[etfCode] × step_ratio[etfCode]
 *   例如：某ETF初始30%、倍数=2、step_ratio=5%，则该档实际占比 = 30 + 2×5 = 40%
 *   数据库存的是 {etfCode: 倍数}，路由层 config.js 的 formatRatios 会转成 [{etfCode, targetRatio}] 数组。
 */
const BaseModel = require('./BaseModel');

class StrategyAConfig extends BaseModel {
    static tableName = 'strategy_a_config';
    static pk = 'id';

    /**
     * 获取策略 A 目前所有的原始档位物理层级列表 (按 level_order ASC 排序)
     * @returns {Promise<Array>}
     */
    static async getLevels() {
        return await this.findAll(null, [], 'level_order ASC');
    }

    /**
     * 获取策略 A 目前所有的档位配置规则列表 (自动解析 ratios JSON)
     * @returns {Promise<Array>}
     */
    static async getRules() {
        const list = await this.findAll(null, [], 'trigger_type, level_order ASC');
        return list.map(item => {
            let parsedRatios = {};
            if (item.ratios) {
                try {
                    parsedRatios = typeof item.ratios === 'string' ? JSON.parse(item.ratios) : item.ratios;
                } catch (e) {
                    parsedRatios = {};
                }
            }
            return {
                id: item.id,
                triggerType: item.trigger_type,
                levelOrder: item.level_order,
                threshold: parseFloat(item.threshold),
                ratios: parsedRatios
            };
        });
    }

    /**
     * 一键保存或全量重置策略 A 的配置档位规则 (规范化事务存盘)
     * @param {Array} rulesList 前端传来的最新档位规则数组
     * @returns {Promise<boolean>} 是否全部成功
     */
    static async saveRules(rulesList) {
        // 使用数据库封装好的通用事务底座，防范意外错误
        const db = require('../config/db');
        return await db.transaction(async () => {
            // 1. 全量清空当前配置
            await this.deleteWhere('1 = 1');
            
            // 2. 依次模型化插入最新规则
            for (const r of rulesList) {
                await this.create({
                    trigger_type: r.triggerType,
                    level_order: r.levelOrder,
                    threshold: r.threshold,
                    ratios: typeof r.ratios === 'object' ? JSON.stringify(r.ratios) : r.ratios
                });
            }
            return true;
        });
    }
}

module.exports = StrategyAConfig;
