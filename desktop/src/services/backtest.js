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
     * 执行单次回测
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
            `, [startDate, endDate]);

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

            // 基准数据映射：trade_date -> close_price
            const benchmarkMap = {};
            for (const row of benchmarkData) {
                benchmarkMap[row.trade_date] = parseFloat(row.close_price);
            }

            // ETF 初始价格（用于计算 etfPerformances）
            const etfFirstPrices = {};
            for (const etf of etfs) {
                etfFirstPrices[etf.code] = this.getFirstPrice(historyData[etf.code], startDate);
            }

            for (const date of allDates) {
                // 更新持仓市值
                const marketValue = this.calculateMarketValue(holdings, historyData, date);
                currentNav = marketValue + cash;

                // 计算基准值（线性插值找最近日期）
                let benchmarkValue = null;
                if (benchmarkData.length > 0) {
                    const bmPrice = this.getBenchmarkPrice(benchmarkData, date);
                    if (bmPrice && benchmarkData[0]) {
                        const firstBmPrice = parseFloat(benchmarkData[0].close_price);
                        benchmarkValue = bmPrice / firstBmPrice * initialCapital;
                    }
                }

                // 计算各 ETF 独立表现（归一化到初始资金）
                const etfPerformances = {};
                for (const etf of etfs) {
                    const price = this.getPrice(historyData[etf.code], date);
                    const firstPrice = etfFirstPrices[etf.code];
                    if (price && firstPrice) {
                        etfPerformances[etf.code] = price / firstPrice * initialCapital;
                    } else {
                        etfPerformances[etf.code] = 0;
                    }
                }

                // 计算资产配比（%）
                const assetRatios = {};
                const totalValue = currentNav;
                if (totalValue > 0) {
                    assetRatios.cash = (cash / totalValue) * 100;
                    for (const etf of etfs) {
                        const price = this.getPrice(historyData[etf.code], date);
                        const posValue = holdings[etf.code] ? holdings[etf.code].shares * (price || 0) : 0;
                        assetRatios[etf.code] = (posValue / totalValue) * 100;
                    }
                }

                // 更新最大净值
                if (currentNav > maxNav) {
                    maxNav = currentNav;
                }

                // 计算回撤
                const drawdown = maxNav > 0 ? ((currentNav - maxNav) / maxNav) * 100 : 0;

                dailyValues.push({
                    date,
                    totalValue: currentNav,
                    cash,
                    marketValue,
                    benchmarkValue,
                    etfPerformances,
                    assetRatios,
                    drawdown
                });
            }

            // 6. 计算量化指标
            const totalReturn = ((currentNav - initialCapital) / initialCapital) * 100;
            const annualReturn = this.calcAnnualReturn(totalReturn, startDate, endDate);
            const maxDrawdown = this.calcMaxDrawdown(dailyValues);
            const annualVolatility = this.calcVolatility(dailyValues);
            const sharpeRatio = this.calcSharpeRatio(annualReturn, annualVolatility);

            // 7. 计算基准指标
            let benchmarkMetrics = null;
            if (benchmarkData.length > 0) {
                const firstBmPrice = parseFloat(benchmarkData[0].close_price);
                const lastBmPrice = parseFloat(benchmarkData[benchmarkData.length - 1].close_price);
                const bmTotalReturn = ((lastBmPrice - firstBmPrice) / firstBmPrice) * 100;
                const bmAnnualReturn = this.calcAnnualReturn(bmTotalReturn, startDate, endDate);
                const bmDrawdown = this.calcBenchmarkDrawdown(benchmarkData);
                const bmVolatility = this.calcBenchmarkVolatility(benchmarkData);
                const bmSharpe = this.calcSharpeRatio(bmAnnualReturn, bmVolatility);

                benchmarkMetrics = {
                    name: '沪深300',
                    totalReturn: bmTotalReturn,
                    annualReturn: bmAnnualReturn,
                    maxDrawdown: bmDrawdown,
                    annualVolatility: bmVolatility,
                    sharpeRatio: bmSharpe
                };
            }

            // 8. 计算各 ETF 独立指标
            const etfMetrics = {};
            for (const etf of etfs) {
                const data = historyData[etf.code];
                if (data && data.length > 0) {
                    const firstPrice = parseFloat(data[0].close_price);
                    const lastPrice = parseFloat(data[data.length - 1].close_price);
                    const etfTotalReturn = ((lastPrice - firstPrice) / firstPrice) * 100;
                    const etfAnnualReturn = this.calcAnnualReturn(etfTotalReturn, startDate, endDate);
                    const etfDrawdown = this.calcBenchmarkDrawdown(data);
                    const etfVol = this.calcBenchmarkVolatility(data);
                    const etfSharpe = this.calcSharpeRatio(etfAnnualReturn, etfVol);

                    etfMetrics[etf.code] = {
                        name: etf.name || etf.code,
                        totalReturn: etfTotalReturn,
                        annualReturn: etfAnnualReturn,
                        maxDrawdown: etfDrawdown,
                        annualVolatility: etfVol,
                        sharpeRatio: etfSharpe
                    };
                }
            }

            // 9. 计算历年收益
            const yearlyStats = this.calcYearlyStats(dailyValues, benchmarkData, initialCapital);

            // 10. 保存回测结果（非寻优模式）
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
                benchmarkMetrics,
                etfMetrics,
                yearlyStats,
                tradeRecords: [],
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
            bestParams: results[0] || null
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

    /** 获取指定日期的收盘价（精确匹配） */
    getPrice(data, date) {
        for (const row of data) {
            if (row.trade_date === date) {
                return parseFloat(row.close_price);
            }
        }
        return null;
    }

    /** 获取基准数据中最近日期的收盘价 */
    getBenchmarkPrice(benchmarkData, date) {
        // 先尝试精确匹配
        for (const row of benchmarkData) {
            if (row.trade_date === date) {
                return parseFloat(row.close_price);
            }
        }
        // 精确匹配不到，取最近一个小于 date 的值
        let lastPrice = null;
        for (const row of benchmarkData) {
            if (row.trade_date <= date) {
                lastPrice = parseFloat(row.close_price);
            } else {
                break;
            }
        }
        return lastPrice;
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

    /** 从 dailyValues 计算最大回撤 */
    calcMaxDrawdownFromDaily(dailyValues) {
        return calcMaxDrawdown(dailyValues.map(d => d.totalValue));
    }

    calcAnnualReturn(totalReturn, startDate, endDate) {
        return calcAnnualReturnFromDates(totalReturn, startDate, endDate);
    }

    calcMaxDrawdown(dailyValues) {
        return calcMaxDrawdown(dailyValues.map(d => d.totalValue));
    }

    calcVolatility(dailyValues) {
        const returns = [];
        for (let i = 1; i < dailyValues.length; i++) {
            returns.push(((dailyValues[i].totalValue - dailyValues[i - 1].totalValue) / dailyValues[i - 1].totalValue) * 100);
        }
        return calcVolatility(returns);
    }

    calcSharpeRatio(annualReturn, annualVolatility) {
        return calcSharpeRatio(annualReturn, 3, annualVolatility);
    }

    /** 计算基准数据的最大回撤 */
    calcBenchmarkDrawdown(data) {
        const values = data.map(r => parseFloat(r.close_price));
        return calcMaxDrawdown(values);
    }

    /** 计算基准数据的年化波动率 */
    calcBenchmarkVolatility(data) {
        const prices = data.map(r => parseFloat(r.close_price));
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
        }
        return calcVolatility(returns);
    }

    /** 计算历年收益 */
    calcYearlyStats(dailyValues, benchmarkData, initialCapital) {
        const yearlyMap = {};

        for (const d of dailyValues) {
            const year = d.date.slice(0, 4);
            if (!yearlyMap[year]) {
                yearlyMap[year] = { first: d, last: d };
            } else {
                yearlyMap[year].last = d;
            }
        }

        // 基准数据按日期映射
        const bmMap = {};
        for (const row of benchmarkData) {
            bmMap[row.trade_date] = parseFloat(row.close_price);
        }
        const firstBmPrice = benchmarkData.length > 0 ? parseFloat(benchmarkData[0].close_price) : null;

        const stats = [];
        for (const year of Object.keys(yearlyMap).sort()) {
            const { first, last } = yearlyMap[year];
            const strategyReturn = first.totalValue > 0
                ? ((last.totalValue - first.totalValue) / first.totalValue) * 100
                : 0;

            // 基准年度收益
            let benchmarkReturn = 0;
            if (firstBmPrice && bmMap[first.date] && bmMap[last.date]) {
                benchmarkReturn = ((bmMap[last.date] - bmMap[first.date]) / bmMap[first.date]) * 100;
            }

            stats.push({
                year: parseInt(year),
                strategyReturn: parseFloat(strategyReturn.toFixed(2)),
                benchmarkReturn: parseFloat(benchmarkReturn.toFixed(2))
            });
        }

        return stats;
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
