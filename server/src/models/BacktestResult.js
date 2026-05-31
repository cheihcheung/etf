/**
 * ==========================================================
 * ETF多资产动态配置策略系统 - 回测与参数寻优结果模型 (BacktestResult Model)
 * ==========================================================
 * 映射物理表：backtest_results
 * 持久化保存单次历史回测指标、参数寻优遍历结果，并提供精简排行榜加载。
 */
const BaseModel = require('./BaseModel');

class BacktestResult extends BaseModel {
    static tableName = 'backtest_results';
    static pk = 'id';

    /**
     * 一键保存一条全新的回测/参数寻优结果记录
     * @param {string} name 记录展示名称
     * @param {object} params 回测时设定的完整参数对象 (会被自动序列化为 JSON 字符串)
     * @param {number} totalReturn 总收益率 (%)
     * @param {number} annualReturn 年化收益率 (%)
     * @param {number} maxDrawdown 最大回撤 (%)
     * @param {number} annualVolatility 年化波动率 (%)
     * @param {number} sharpeRatio 夏普比率
     * @param {object|null} dailyDetail 每日资产走势大 JSON 对象 (寻优时传入 null，精细回测时自动序列化存盘)
     * @returns {Promise<object>}
     */
    static async saveResult(name, params, totalReturn, annualReturn, maxDrawdown, annualVolatility, sharpeRatio, dailyDetail = null) {
        return await this.create({
            name: name,
            params: JSON.stringify(params),
            total_return: totalReturn,
            annual_return: annualReturn,
            max_drawdown: maxDrawdown,
            annual_volatility: annualVolatility,
            sharpe_ratio: sharpeRatio,
            daily_detail: dailyDetail ? JSON.stringify(dailyDetail) : null,
            create_time: new Date() // 写入当前时间
        });
    }

    /**
     * 加载精简回测排行榜列表 (自动剔除极占带宽的 daily_detail 大字段，大幅缩减网络IO，提升加载响应)
     * @returns {Promise<Array>}
     */
    static async getRankings() {
        const sql = `
            SELECT id, name, params, 
                   total_return, total_return AS totalReturn, 
                   annual_return, annual_return AS annualReturn,
                   max_drawdown, max_drawdown AS maxDrawdown, 
                   annual_volatility, annual_volatility AS annualVolatility,
                   sharpe_ratio, sharpe_ratio AS sharpeRatio, 
                   create_time, create_time AS createTime
            FROM ${this.tableName}
            ORDER BY create_time DESC
            LIMIT 500
        `;
        return await this.query(sql);
    }
}

module.exports = BacktestResult;
