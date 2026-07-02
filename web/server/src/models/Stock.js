/**
 * ==========================================================
 * 多资产策略回测系统 - ETF标的模型 (Stock Model)
 * ==========================================================
 * 映射物理表：stock
 * 承载标的资产的实时行情行情同步、配置初始配比维护等核心实体方法。
 *
 * 【表结构关键字段】
 *   - code          : ETF 证券代码(如 510300)，唯一键
 *   - name          : ETF 名称(如 "沪深300ETF")
 *   - asset_type    : 资产类型(股票类/债券类/红利类/商品类/黄金类)
 *   - current_price : 最新价格
 *   - change_pct    : 今日涨跌幅(%)
 *   - initial_ratio : 初始配置占比(%)，组合配置的核心字段
 *   - is_enabled    : 是否启用(1启用/0禁用)，禁用的标的不参与回测(回测引擎会物理剥离)
 *   - step_ratio    : 加减比步长(%)，默认5.00。策略档位倍数模型的核心参数
 *
 * ⚠️ 【step_ratio 与 is_enabled 是后期热迁移字段】
 *   这两个字段由 index.js 启动时自动 ALTER TABLE 追加，旧表升级时无需手动改表结构。
 */
const BaseModel = require('./BaseModel');

class Stock extends BaseModel {
    static tableName = 'stock';
    static pk = 'id';

    /**
     * 联表聚合获取所有 ETF 及其行情记录起止范围
     * @returns {Promise<Array>}
     */
    static async getWithHistoryRange() {
        const sql = `
            SELECT b.*,
                   MIN(h.trade_date) AS history_start,
                   MAX(h.trade_date) AS history_end
            FROM stock b
            LEFT JOIN history_data h ON b.code = h.etf_code
            GROUP BY b.id, b.code, b.name, b.asset_type, b.current_price, b.change_pct, b.update_time, b.initial_ratio
            ORDER BY b.asset_type, b.code
        `;
        return await this.query(sql);
    }

    /**
     * 根据 ETF Code 一键更新初始资产占比
     * @param {string} code ETF 证券代码，例如 '510300'
     * @param {number} ratio 占比百分比 (0-100)
     * @returns {Promise<object>}
     */
    static async updateRatio(code, ratio) {
        return await this.updateWhere({ code }, [], { initial_ratio: ratio });
    }

    /**
     * 一键同步更新 ETF 的最新实时价格与涨跌幅
     * @param {string} code ETF 证券代码
     * @param {number} price 最新价
     * @param {number} changePct 今日涨跌幅百分比
     * @returns {Promise<object>}
     */
    static async syncPrice(code, price, changePct) {
        return await this.updateWhere({ code }, [], {
            current_price: price,
            change_pct: changePct,
            update_time: new Date()
        });
    }
}

module.exports = Stock;