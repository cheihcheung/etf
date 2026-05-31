/**
 * ==========================================================
 * ETF多资产动态配置策略系统 - 策略B估值偏离档位参数模型 (StrategyBConfig Model)
 * ==========================================================
 * 映射物理表：strategy_b_config
 * 承载策略 B 的判定档位、估值偏离中枢阈值及配比 JSON，提供扁平化读取与一键保存。
 */
const BaseModel = require('./BaseModel');

class StrategyBConfig extends BaseModel {
    static tableName = 'strategy_b_config';
    static pk = 'id';

    /**
     * 获取策略 B 目前所有的原始档位物理层级列表 (按 level_order ASC 排序)
     * @returns {Promise<Array>}
     */
    static async getLevels() {
        return await this.findAll(null, [], 'level_order ASC');
    }

    /**
     * 获取策略 B 目前所有的档位配置规则列表 (自动反序列化 ratios JSON)
     * @returns {Promise<Array>}
     */
    static async getRules() {
        const list = await this.findAll(null, [], 'deviation_type, level_order ASC');
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
                deviationType: item.deviation_type,
                levelOrder: item.level_order,
                threshold: parseFloat(item.threshold),
                ratios: parsedRatios
            };
        });
    }

    /**
     * 一键保存或全量重置策略 B 的配置档位规则 (规范化事务存盘)
     * @param {Array} rulesList 前端传来的最新档位规则数组
     * @returns {Promise<boolean>} 是否全部成功
     */
    static async saveRules(rulesList) {
        const db = require('../config/db');
        return await db.transaction(async () => {
            // 1. 全量清空
            await this.deleteWhere('1 = 1');
            
            // 2. 一键模型化插入
            for (const r of rulesList) {
                await this.create({
                    deviation_type: r.deviationType,
                    level_order: r.levelOrder,
                    threshold: r.threshold,
                    ratios: typeof r.ratios === 'object' ? JSON.stringify(r.ratios) : r.ratios
                });
            }
            return true;
        });
    }
}

module.exports = StrategyBConfig;
