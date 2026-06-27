/**
 * SQLite 版本的回测服务（desktop 独立版）
 * 核心回测逻辑保留，适配 SQLite 数据库
 * 量化指标计算引用 desktop/utils.js
 */
const {
    calcAnnualReturnFromDates,
    calcMaxDrawdown,
    calcVolatility,
    calcSharpeRatio
} = require('../utils');

class BacktestService {
    constructor(db) {
        this.db = db;
    }

    /**
     * 执行单次回测（简化版）
     */
    async runBacktest(params) {
        try {
            const {
                startDate,
                endDate,
                initialCapital = 1000000,
                feeRate = 0.03,
                etfs = [],
                initialRatios = {},
                strategyAConfig = null,
                strategyBConfig = null,
                rebalanceThreshold = 1.5,
                tradeFrequency = 'monthly',
                isOptimization = false
            } = params;

            // 1. 获取历史数据
            const historyData = {};
            for (const etf of etfs) {
                const data = this.db.query(`
                    SELECT trade_date, close_price
                    FROM history_data
                    WHERE etf_code = ? AND trade_date >= ? AND trade_date <= ?
                    ORDER BY trade_date ASC
                `, [etf.code, startDate, endDate]);

                if (data.length === 0) {
                    return { error: `${etf.code} 缺少历史数据` };
                }
                historyData[etf.code] = data;
            }

            // 2. 获取基准数据（沪深300）
            const benchmarkData = this.db.query(`
                SELECT trade_date, close_price
                FROM history_data
                WHERE etf_code = '000300' AND trade_date >= ? AND trade_date <= ?
                ORDER BY trade_date ASC
            `, ['000300', startDate, endDate]);

            // 3. 合并所有交易日期
            const allDates = this.mergeDates(historyData);

            // 4. 初始化持仓
            const holdings = {};
            const totalRatio = Object.values(initialRatios).reduce((sum, r) => sum + r, 0);

            for (const etf of etfs) {
                const ratio = initialRatios[etf.code] || 0;
                const firstPrice = this.getFirstPrice(historyData[etf.code], startDate);
                if (firstPrice) {
                    const shares = Math.floor((initialCapital * ratio / 100) / firstPrice);
                    holdings[etf.code] = {
                        shares,
                        cost: firstPrice,
                        ratio
                    };
                }
            }

            // 5. 逐日计算净值
            const dailyValues = [];
            let cash = initialCapital - this.calculateTotalCost(holdings, historyData, startDate);
            let maxNav = initialCapital;
            let currentNav = initialCapital;

            for (const date of allDates) {
                // 更新持仓市值
                const marketValue = this.calculateMarketValue(holdings, historyData, date);
                currentNav = marketValue + cash;

                // 记录每日净值
                dailyValues.push({
                    date,
                    nav: currentNav,
                    cash,
                    marketValue,
                    holdings: JSON.parse(JSON.stringify(holdings))
                });

                // 更新最大净值
                if (currentNav > maxNav) {
                    maxNav = currentNav;
                }
            }

            // 6. 计算量化指标
            const totalReturn = ((currentNav - initialCapital) / initialCapital) * 100;
            const annualReturn = this.calcAnnualReturn(totalReturn, startDate, endDate);
            const maxDrawdown = this.calcMaxDrawdown(dailyValues);
            const annualVolatility = this.calcVolatility(dailyValues);
            const sharpeRatio = this.calcSharpeRatio(annualReturn, annualVolatility);

            // 7. 保存回测结果（非寻优模式）
            if (!isOptimization) {
                this.db.execute(`
                    INSERT INTO backtest_results (name, params, total_return, annual_return, max_drawdown, annual_volatility, sharpe_ratio, daily_detail, create_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    `回测_${startDate}_${endDate}`,
                    JSON.stringify(params),
                    totalReturn,
                    annualReturn,
                    maxDrawdown,
                    annualVolatility,
                    sharpeRatio,
                    JSON.stringify(dailyValues),
                    new Date().toISOString()
                ]);
            }

            return {
                totalReturn,
                annualReturn,
                maxDrawdown,
                annualVolatility,
                sharpeRatio,
                dailyValues,
                startDate,
                endDate,
                initialCapital,
                params
            };
        } catch (error) {
            return { error: String(error && error.message ? error.message : error) };
        }
    }

    /**
     * 参数寻优（简化版）
     */
    async runParameterOptimization(params) {
        const { baseParams, optimizationRanges } = params;

        // 生成参数组合
        const combinations = this.generateCombinations(optimizationRanges);
        const results = [];

        for (const combo of combinations) {
            const testParams = { ...baseParams, ...combo, isOptimization: true };
            const result = await this.runBacktest(testParams);

            if (!result.error) {
                results.push({
                    params: combo,
                    totalReturn: result.totalReturn,
                    annualReturn: result.annualReturn,
                    maxDrawdown: result.maxDrawdown,
                    sharpeRatio: result.sharpeRatio
                });
            }
        }

        // 按夏普比率排序
        results.sort((a, b) => b.sharpeRatio - a.sharpeRatio);

        return {
            totalCombinations: combinations.length,
            sortedResults: results.slice(0, 50),
            bestParams: results[0] ? results[0].params : null
        };
    }

    /**
     * 获取回测结果列表
     */
    async getBacktestResults() {
        return this.db.query(`
            SELECT id, name, params, total_return, annual_return, max_drawdown, annual_volatility, sharpe_ratio, create_time
            FROM backtest_results
            ORDER BY create_time DESC
            LIMIT 500
        `);
    }

    /**
     * 获取回测详情
     */
    async getBacktestDetail(id) {
        const result = this.db.queryOne(`
            SELECT * FROM backtest_results WHERE id = ?
        `, [id]);

        if (result && result.daily_detail) {
            try {
                result.daily_detail = JSON.parse(result.daily_detail);
            } catch (e) {
                result.daily_detail = [];
            }
        }

        return result;
    }

    // ==================== 辅助函数 ====================

    mergeDates(historyData) {
        const dateSet = new Set();
        for (const code in historyData) {
            for (const row of historyData[code]) {
                dateSet.add(row.trade_date);
            }
        }
        return Array.from(dateSet).sort();
    }

    getFirstPrice(data, startDate) {
        for (const row of data) {
            if (row.trade_date >= startDate) {
                return parseFloat(row.close_price);
            }
        }
        return null;
    }

    calculateTotalCost(holdings, historyData, date) {
        let total = 0;
        for (const code in holdings) {
            const price = this.getPrice(historyData[code], date);
            if (price) {
                total += holdings[code].shares * price;
            }
        }
        return total;
    }

    calculateMarketValue(holdings, historyData, date) {
        let total = 0;
        for (const code in holdings) {
            const price = this.getPrice(historyData[code], date);
            if (price) {
                total += holdings[code].shares * price;
            }
        }
        return total;
    }

    getPrice(data, date) {
        for (const row of data) {
            if (row.trade_date === date) {
                return parseFloat(row.close_price);
            }
        }
        return null;
    }

    calcAnnualReturn(totalReturn, startDate, endDate) {
        return calcAnnualReturnFromDates(totalReturn, startDate, endDate);
    }

    calcMaxDrawdown(dailyValues) {
        return calcMaxDrawdown(dailyValues.map(d => d.nav));
    }

    calcVolatility(dailyValues) {
        const returns = [];
        for (let i = 1; i < dailyValues.length; i++) {
            returns.push(((dailyValues[i].nav - dailyValues[i - 1].nav) / dailyValues[i - 1].nav) * 100);
        }
        return calcVolatility(returns);
    }

    calcSharpeRatio(annualReturn, annualVolatility) {
        return calcSharpeRatio(annualReturn, 3, annualVolatility);
    }

    generateCombinations(ranges) {
        const keys = Object.keys(ranges);
        const combinations = [];

        const generate = (index, current) => {
            if (index === keys.length) {
                combinations.push(current);
                return;
            }

            const key = keys[index];
            for (const value of ranges[key]) {
                generate(index + 1, { ...current, [key]: value });
            }
        };

        generate(0, {});
        return combinations;
    }
}

module.exports = BacktestService;