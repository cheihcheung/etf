/**
 * ==========================================================
 * 多资产策略回测系统 - 历史行情数据模型 (HistoryData Model)
 * ==========================================================
 * 映射物理表：history_data
 * 提供历史走势的极速批量检索、大批量插入及行情最后时间获取服务。
 */
const BaseModel = require('./BaseModel');

class HistoryData extends BaseModel {
    static tableName = 'history_data';
    static pk = 'id';

    /**
     * 根据日期起止范围快速获取标的 K 线历史序列
     * @param {string} code ETF 证券代码
     * @param {string} startDate 'YYYY-MM-DD'
     * @param {string} endDate 'YYYY-MM-DD'
     * @returns {Promise<Array>}
     */
    static async getHistoryByRange(code, startDate, endDate) {
        return await this.findAll(
            'etf_code = ? AND trade_date >= ? AND trade_date <= ?',
            [code, startDate, endDate],
            'trade_date ASC'
        );
    }

    /**
     * 获取标的最有一条历史K线数据的具体日期（用于行情自动补全起点的判断）
     * @param {string} code ETF 证券代码
     * @returns {Promise<string|null>} 最新一条行情日期 (YYYY-MM-DD)
     */
    static async getLastRecordDate(code) {
        const sql = `SELECT MAX(trade_date) AS last_date FROM ${this.tableName} WHERE etf_code = ?`;
        const res = await this.query(sql, [code]);
        return res[0]?.last_date || null;
    }
}

module.exports = HistoryData;