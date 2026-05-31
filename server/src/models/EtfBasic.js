/**
 * ==========================================================
 * ETF多资产动态配置策略系统 - ETF基础数据模型 (EtfBasic Model)
 * ==========================================================
 * 映射物理表：etf_basic
 * 承载标的资产的实时行情行情同步、配置初始配比维护等核心实体方法。
 */
const BaseModel = require('./BaseModel');

class EtfBasic extends BaseModel {
    static tableName = 'etf_basic';
    static pk = 'id';

    /**
     * 联表聚合获取所有 ETF 及其行情记录起止范围 (完美平替 routes/etf.js 中的 SQL GROUP BY 聚合)
     * @returns {Promise<Array>}
     */
    static async getWithHistoryRange() {
        const sql = `
            SELECT b.*,
                   MIN(h.trade_date) AS history_start,
                   MAX(h.trade_date) AS history_end
            FROM etf_basic b
            LEFT JOIN etf_history h ON b.code = h.etf_code
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

module.exports = EtfBasic;
