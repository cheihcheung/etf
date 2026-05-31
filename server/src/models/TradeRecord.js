/**
 * ==========================================================
 * ETF多资产动态配置策略系统 - 交易明细流水模型 (TradeRecord Model)
 * ==========================================================
 * 映射物理表：trade_records
 * 承载回测与实盘环境下的所有买入/卖出调仓交易流水的记录与持久化。
 */
const BaseModel = require('./BaseModel');

class TradeRecord extends BaseModel {
    static tableName = 'trade_records';
    static pk = 'id';

    /**
     * 一键记录一条全新的调仓交易流水
     * @param {string} date 调仓具体日期时间 (YYYY-MM-DD HH:mm:ss)
     * @param {string} code ETF 证券代码
     * @param {string} action 交易动作：'BUY' (买入) 或 'SELL' (卖出)
     * @param {number} shares 调仓股份数
     * @param {number} price 调仓成交价格
     * @param {number} amount 成交金额 (元)
     * @param {number} fee 交易手续费 (元)
     * @param {string} reason 触发本次调仓的详细算法研判理由 (如 偏离加仓/反弹调仓)
     * @param {string} type 交易类型：'backtest' (历史回测) 或 'realtime' (实盘记录)
     * @returns {Promise<object>}
     */
    static async logTrade(date, code, action, shares, price, amount, fee, reason, type = 'backtest') {
        return await this.create({
            trade_time: date,
            trade_type: type,
            etf_code: code,
            trade_direction: action,
            shares: shares,
            price: price,
            amount: amount,
            fee: fee,
            reason: reason
        });
    }

    /**
     * 获取最近交易流水列表
     * @param {number} limit 默认查询最新 2000 条
     * @returns {Promise<Array>}
     */
    static async getRecentTrades(limit = 2000) {
        return await this.findAll(null, [], 'trade_time DESC', limit);
    }
}

module.exports = TradeRecord;
