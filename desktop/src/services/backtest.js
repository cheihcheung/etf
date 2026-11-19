/**
 * ==========================================================================================
 * 多资产策略回测引擎（Desktop SQLite 完整版）
 * ==========================================================================================
 * 提供多资产动态再平衡、策略A（回撤/反弹档位策略）、策略B（年化中枢偏离估值策略）、
 * 决策融合引擎、先卖后买实盘级交易执行、价格记忆保护（绝不归零）、多维量化指标与参数寻优。
 * ==========================================================================================
 */

const {
    calcAnnualReturn,
    calcMaxDrawdown,
    calcVolatility,
    calcSharpeRatio,
    calcFee
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
            let {
                startDate,
                endDate,
                initialCapital = 1000000,
                feeRate = 0.03, // 百分比数值，如 0.03 表示 0.03%
                feeExemptFive = true,
                etfs = [],
                initialRatios = {},
                strategyAConfig = null,
                strategyBConfig = null,
                rebalanceConfig = null,
                rebalanceThreshold = 1.5,
                tradeFrequency = 'monthly',
                strategyPriority = 'rebalance',
                centralAnnual = 10,
                resetOnHigh = true,
                tradeMatchMode = 'close', // 'close' (当日收盘价撮合) 或 'next_open' (次日开盘价撮合)
                drawdownBuffer = 1.0,     // 策略A回撤防抖盲区(%)，消除临界震荡摩擦损耗
                isOptimization = false
            } = params;

            // 0. 静默清洗：剥离被禁用(is_enabled = 0)的 ETF
            try {
                const disabledRows = this.db.query("SELECT code FROM stock WHERE is_enabled = 0");
                const disabledCodes = (disabledRows || []).map(r => r.code);
                if (disabledCodes.length > 0) {
                    etfs = etfs.filter(e => !disabledCodes.includes(e.code));
                    disabledCodes.forEach(code => {
                        delete initialRatios[code];
                    });
                }
            } catch (err) {
                // ignore
            }

            // 0.1 加载各标的专属加减比步长 step_ratio
            const stepRatios = {};
            try {
                const allStocks = this.db.query("SELECT code, step_ratio FROM stock");
                (allStocks || []).forEach(s => {
                    stepRatios[s.code] = parseFloat(s.step_ratio != null ? s.step_ratio : 5.0);
                });
            } catch (err) {
                // ignore
            }

            // 1. 确定对比基准（优先 is_benchmark=1，次优 000300）
            let benchmarkCode = null;
            let benchmarkName = '对比基准';
            try {
                const bmRow = this.db.queryOne("SELECT code, name FROM stock WHERE is_benchmark = 1 LIMIT 1");
                if (bmRow) {
                    benchmarkCode = bmRow.code;
                    benchmarkName = bmRow.name || benchmarkCode;
                } else {
                    const default300 = this.db.queryOne("SELECT code, name FROM stock WHERE code = '000300' LIMIT 1");
                    if (default300) {
                        benchmarkCode = '000300';
                        benchmarkName = default300.name || '沪深300';
                    }
                }
            } catch (err) {
                // ignore
            }

            // 2. 获取标的历史行情数据
            const historyDataMap = {};
            for (const etf of etfs) {
                const rows = this.db.query(`
                    SELECT trade_date, close_price, open_price
                    FROM history_data
                    WHERE etf_code = ? AND trade_date >= ? AND trade_date <= ?
                    ORDER BY trade_date ASC
                `, [etf.code, startDate, endDate]);

                if (!rows || rows.length === 0) {
                    return { error: `${etf.name || etf.code} (${etf.code}) 在 ${startDate} ~ ${endDate} 缺少历史数据` };
                }

                const scaleFactor = etf.scale_factor ? parseInt(etf.scale_factor) : 1;
                historyDataMap[etf.code] = rows.map(r => ({
                    tradeDate: String(r.trade_date).slice(0, 10),
                    closePrice: parseFloat(r.close_price) / scaleFactor,
                    openPrice: parseFloat(r.open_price || r.close_price) / scaleFactor
                }));
            }

            // 3. 获取基准历史行情
            let benchmarkHistory = [];
            if (benchmarkCode) {
                const bmRows = this.db.query(`
                    SELECT trade_date, close_price
                    FROM history_data
                    WHERE etf_code = ? AND trade_date >= ? AND trade_date <= ?
                    ORDER BY trade_date ASC
                `, [benchmarkCode, startDate, endDate]);
                if (bmRows && bmRows.length > 0) {
                    benchmarkHistory = bmRows.map(r => ({
                        tradeDate: String(r.trade_date).slice(0, 10),
                        closePrice: parseFloat(r.close_price)
                    }));
                }
            }

            // 4. 合并所有交易日期形成时间轴
            const allDatesSet = new Set();
            benchmarkHistory.forEach(h => allDatesSet.add(h.tradeDate));
            Object.values(historyDataMap).forEach(data => {
                data.forEach(d => allDatesSet.add(d.tradeDate));
            });
            const sortedDates = Array.from(allDatesSet).sort();

            if (sortedDates.length === 0) {
                return { error: '未获取到任何历史数据，请先同步行情' };
            }

            // 5. 初始化核心运行时状态
            let cash = initialCapital;
            let portfolio = {}; // { [code]: { shares, costPrice, ratio, isListed } }
            let totalValue = initialCapital;
            const dailyValues = [];
            const dailyReturns = [];
            const tradeRecords = [];
            let historyHighValue = initialCapital;
            let currentALevel = 0;
            let currentBLevel = 0;
            let activeTargetRatios = { ...initialRatios };

            // 价格记忆表：停牌或数据断档时沿用，绝不归零
            const lastValidPrices = {};
            let lastBenchmarkPrice = benchmarkHistory.length > 0 ? benchmarkHistory[0].closePrice : 0;
            const benchmarkBasePrice = lastBenchmarkPrice;

            // 建立日期索引快速查找（收盘价与开盘价）
            const datePriceIndexed = {};
            const dateOpenPriceIndexed = {};
            etfs.forEach(e => {
                datePriceIndexed[e.code] = new Map();
                dateOpenPriceIndexed[e.code] = new Map();
                (historyDataMap[e.code] || []).forEach(row => {
                    datePriceIndexed[e.code].set(row.tradeDate, row.closePrice);
                    dateOpenPriceIndexed[e.code].set(row.tradeDate, row.openPrice || row.closePrice);
                });
            });

            // 次日开盘撮合模式下的待执行挂单
            let pendingTrade = null;

            // 初始化持仓结构
            for (const etf of etfs) {
                portfolio[etf.code] = { shares: 0, costPrice: 0, ratio: 0, isListed: false };
            }

            // 首日初始建仓（按 100 股向下取整）
            const firstTradeDate = sortedDates[0];
            for (const etf of etfs) {
                const ratio = initialRatios[etf.code] || 0;
                if (ratio <= 0) continue;

                const firstDayPrice = datePriceIndexed[etf.code].get(firstTradeDate);
                if (firstDayPrice && firstDayPrice > 0) {
                    const targetValue = initialCapital * (ratio / 100);
                    const shares = Math.floor(targetValue / firstDayPrice / 100) * 100;
                    if (shares > 0) {
                        const amount = shares * firstDayPrice;
                        const fee = calcFee(amount, feeRate, feeExemptFive);

                        portfolio[etf.code] = {
                            shares,
                            costPrice: firstDayPrice,
                            ratio,
                            isListed: true
                        };
                        cash -= (amount + fee);
                        lastValidPrices[etf.code] = firstDayPrice;

                        tradeRecords.push({
                            date: firstTradeDate,
                            type: 'init',
                            etfCode: etf.code,
                            action: 'buy',
                            shares,
                            price: firstDayPrice,
                            amount,
                            fee,
                            reason: '初始建仓',
                            totalValue: initialCapital,
                            preAmount: 0,
                            postAmount: amount,
                            preRatio: 0,
                            postRatio: initialCapital > 0 ? (amount / initialCapital * 100) : 0
                        });
                    }
                }
            }

            // 记录各 ETF 的上市首价（用于计算独立对比净值）
            const etfFirstPrices = {};
            for (const etf of etfs) {
                const list = historyDataMap[etf.code] || [];
                etfFirstPrices[etf.code] = list.length > 0 ? list[0].closePrice : null;
            }

            // 6. 逐日时间轴主循环
            for (let i = 0; i < sortedDates.length; i++) {
                const date = sortedDates[i];
                const datePrices = {};
                let didStrategyTrade = false;

                // 6.1 更新价格与维护价格记忆
                for (const etf of etfs) {
                    const priceToday = datePriceIndexed[etf.code].get(date);
                    if (priceToday && priceToday > 0) {
                        datePrices[etf.code] = priceToday;
                        lastValidPrices[etf.code] = priceToday;
                    } else {
                        // 停牌或缺失，严格沿用历史最近有效收盘价，杜绝归零
                        datePrices[etf.code] = lastValidPrices[etf.code] || 0;
                    }
                }

                // 次日开盘价撮合：若前一交易日触发了调仓，在今日开盘按开盘价撮合成交
                if (tradeMatchMode === 'next_open' && pendingTrade) {
                    const openPrices = {};
                    let openMv = 0;
                    for (const etf of etfs) {
                        const op = dateOpenPriceIndexed[etf.code]?.get(date);
                        const curPrice = (op && op > 0) ? op : (datePrices[etf.code] || lastValidPrices[etf.code] || 0);
                        openPrices[etf.code] = curPrice;
                        openMv += (portfolio[etf.code]?.shares || 0) * curPrice;
                    }
                    const openTotalVal = cash + openMv;

                    const tradeRes = this.executeTrades(
                        portfolio, openPrices, pendingTrade.targetRatios, openTotalVal, cash,
                        feeRate, feeExemptFive, `[次日开盘] ${pendingTrade.reason}`, pendingTrade.strategy
                    );

                    if (tradeRes.trades.length > 0) {
                        portfolio = tradeRes.portfolio;
                        cash = tradeRes.cash;
                        tradeRecords.push(...tradeRes.trades.map(t => ({ ...t, date, totalValue: openTotalVal })));
                        if (pendingTrade.strategy === 'strategy_a') {
                            currentALevel = pendingTrade.newLevel;
                            if (pendingTrade.resetHigh) historyHighValue = openTotalVal;
                        } else if (pendingTrade.strategy === 'strategy_b') {
                            currentBLevel = pendingTrade.newLevel;
                        } else if (pendingTrade.strategy === 'rebalance') {
                            const isBackToInit = Object.keys(activeTargetRatios).every(code =>
                                Math.abs((activeTargetRatios[code] || 0) - (initialRatios[code] || 0)) < 0.01
                            );
                            if (isBackToInit) {
                                currentALevel = 0;
                                currentBLevel = 0;
                            }
                        }
                    }
                    pendingTrade = null;
                }

                // 6.2 延迟补仓（针对首日未上市标的）
                let totalMarketValue = 0;
                for (const etf of etfs) {
                    const holding = portfolio[etf.code];
                    const price = datePrices[etf.code] || 0;

                    if (holding && holding.shares === 0 && !holding.isListed && price > 0) {
                        const ratio = initialRatios[etf.code] || 0;
                        if (ratio > 0) {
                            const targetVal = totalValue * (ratio / 100);
                            let shares = Math.floor(targetVal / price / 100) * 100;
                            let amount = shares * price;
                            let fee = calcFee(amount, feeRate, feeExemptFive);

                            if (cash < amount + fee) {
                                // 现金不足降级买入
                                shares = Math.floor((cash * 0.999) / price / 100) * 100;
                                amount = shares * price;
                                fee = calcFee(amount, feeRate, feeExemptFive);
                            }

                            if (shares > 0 && cash >= amount + fee) {
                                holding.isListed = true;
                                holding.shares = shares;
                                holding.costPrice = price;
                                cash -= (amount + fee);

                                tradeRecords.push({
                                    date,
                                    type: 'init',
                                    etfCode: etf.code,
                                    action: 'buy',
                                    shares,
                                    price,
                                    amount,
                                    fee,
                                    reason: '延迟建仓（上市首日）',
                                    totalValue,
                                    preAmount: 0,
                                    postAmount: amount,
                                    preRatio: 0,
                                    postRatio: totalValue > 0 ? (amount / totalValue * 100) : 0
                                });
                            }
                        }
                    }

                    if (holding && price > 0) {
                        totalMarketValue += holding.shares * price;
                    }
                }

                totalValue = cash + totalMarketValue;

                // 6.3 更新最高净值与计算回撤
                if (totalValue > historyHighValue) {
                    historyHighValue = totalValue;
                }
                const drawdown = historyHighValue > 0 ? (historyHighValue - totalValue) / historyHighValue * 100 : 0;

                // 6.4 调仓日研判
                let isTradeDay = false;
                if (tradeFrequency === 'daily') {
                    isTradeDay = true;
                } else if (tradeFrequency === 'weekly') {
                    const d = new Date(date);
                    if (d.getDay() === 5 || i === sortedDates.length - 1) isTradeDay = true;
                } else if (tradeFrequency === 'monthly') {
                    const d = new Date(date);
                    const nextDate = sortedDates[i + 1];
                    if (!nextDate || new Date(nextDate).getMonth() !== d.getMonth()) isTradeDay = true;
                }

                // 6.5 策略信号与决策融合
                if (isTradeDay) {
                    let aResult = null;
                    let bResult = null;

                    // 策略 A 研判（回撤档位）
                    if (strategyAConfig) {
                        const configA = { ...strategyAConfig, resetOnHigh };
                        if (resetOnHigh && totalValue >= historyHighValue && historyHighValue > 0) {
                            if (currentALevel !== 0) {
                                aResult = {
                                    action: 'reset',
                                    reason: '组合净值创历史新高，自动复位至初始配置比例',
                                    ratios: { ...initialRatios },
                                    newLevel: 0,
                                    resetHigh: true
                                };
                            }
                        } else {
                            aResult = this.evaluateStrategyA(configA, drawdown, currentALevel, initialRatios, stepRatios, drawdownBuffer);
                        }
                    }

                    // 策略 B 研判（年化中枢偏离）
                    if (strategyBConfig) {
                        const yearsCount = (new Date(date) - new Date(startDate)) / (365 * 24 * 60 * 60 * 1000);
                        if (yearsCount >= 0.5) {
                            const curTotalReturn = (totalValue - initialCapital) / initialCapital * 100;
                            const curAnnualReturn = calcAnnualReturn(curTotalReturn, Math.max(yearsCount, 0.1));
                            const configB = { ...strategyBConfig, centralAnnual };
                            const deviation = curAnnualReturn - configB.centralAnnual;
                            bResult = this.evaluateStrategyB(configB, deviation, currentBLevel, initialRatios, stepRatios);
                        }
                    }

                    // 再平衡前置检查
                    let isRebalanceTriggered = false;
                    if (rebalanceConfig && rebalanceThreshold > 0) {
                        for (const etf of etfs) {
                            const p = datePrices[etf.code] || 0;
                            if (p <= 0) continue;
                            const curRatio = (portfolio[etf.code].shares * p) / totalValue * 100;
                            const targetRatio = activeTargetRatios[etf.code] || 0;
                            if (Math.abs(curRatio - targetRatio) >= rebalanceThreshold) {
                                isRebalanceTriggered = true;
                                break;
                            }
                        }
                    }

                    // 决策融合裁决
                    let chosenResult = null;
                    let chosenStrategy = '';

                    if (isRebalanceTriggered && strategyPriority === 'rebalance' && (aResult || bResult)) {
                        chosenResult = null; // 压制策略信号，交由再平衡处理
                    } else {
                        if (aResult && bResult) {
                            if (strategyPriority === 'strategy_b') {
                                chosenResult = bResult;
                                chosenStrategy = 'strategy_b';
                            } else {
                                chosenResult = aResult;
                                chosenStrategy = 'strategy_a';
                            }
                        } else if (aResult) {
                            chosenResult = aResult;
                            chosenStrategy = 'strategy_a';
                        } else if (bResult) {
                            chosenResult = bResult;
                            chosenStrategy = 'strategy_b';
                        }
                    }

                    // 执行策略调仓
                    if (chosenResult) {
                        activeTargetRatios = chosenResult.action === 'reset' ? { ...initialRatios } : chosenResult.ratios;
                        if (tradeMatchMode === 'next_open') {
                            // 次日开盘撮合模式：记录挂单，留待下一交易日开盘撮合
                            pendingTrade = {
                                targetRatios: activeTargetRatios,
                                reason: chosenResult.reason,
                                strategy: chosenStrategy,
                                newLevel: chosenResult.newLevel,
                                resetHigh: chosenResult.resetHigh
                            };
                            didStrategyTrade = true;
                        } else {
                            // 当日收盘价撮合
                            const tradeRes = this.executeTrades(
                                portfolio, datePrices, activeTargetRatios, totalValue, cash,
                                feeRate, feeExemptFive, chosenResult.reason, chosenStrategy
                            );

                            if (tradeRes.trades.length > 0) {
                                portfolio = tradeRes.portfolio;
                                cash = tradeRes.cash;
                                totalValue = cash + tradeRes.marketValue;
                                tradeRecords.push(...tradeRes.trades.map(t => ({ ...t, date, totalValue })));
                                if (chosenStrategy === 'strategy_a') {
                                    currentALevel = chosenResult.newLevel;
                                    if (chosenResult.resetHigh) historyHighValue = totalValue;
                                } else if (chosenStrategy === 'strategy_b') {
                                    currentBLevel = chosenResult.newLevel;
                                }
                                didStrategyTrade = true;
                            }
                        }
                    }

                    // 6.6 日常再平衡调仓（若未发生策略交易）
                    if (!didStrategyTrade && rebalanceConfig && rebalanceThreshold > 0) {
                        let needRebalance = false;
                        let maxDevInfo = '';
                        for (const etf of etfs) {
                            const p = datePrices[etf.code] || 0;
                            if (p <= 0) continue;
                            const curRatio = (portfolio[etf.code].shares * p) / totalValue * 100;
                            const targetRatio = activeTargetRatios[etf.code] || 0;
                            const dev = Math.abs(curRatio - targetRatio);
                            if (dev >= rebalanceThreshold) {
                                needRebalance = true;
                                maxDevInfo = `${etf.name || etf.code}偏离${dev.toFixed(2)}%`;
                                break;
                            }
                        }

                        if (needRebalance) {
                            if (tradeMatchMode === 'next_open') {
                                pendingTrade = {
                                    targetRatios: activeTargetRatios,
                                    reason: `日常再平衡(${maxDevInfo})`,
                                    strategy: 'rebalance'
                                };
                            } else {
                                const rebalRes = this.executeTrades(
                                    portfolio, datePrices, activeTargetRatios, totalValue, cash,
                                    feeRate, feeExemptFive, `日常再平衡(${maxDevInfo})`, 'rebalance'
                                );
                                if (rebalRes.trades.length > 0) {
                                    portfolio = rebalRes.portfolio;
                                    cash = rebalRes.cash;
                                    totalValue = cash + rebalRes.marketValue;
                                    tradeRecords.push(...rebalRes.trades.map(t => ({ ...t, date, totalValue })));

                                    const isBackToInit = Object.keys(activeTargetRatios).every(code =>
                                        Math.abs((activeTargetRatios[code] || 0) - (initialRatios[code] || 0)) < 0.01
                                    );
                                    if (isBackToInit) {
                                        currentALevel = 0;
                                        currentBLevel = 0;
                                    }
                                }
                            }
                        }
                    }
                }

                // 6.7 重新统计调仓后持仓市值
                let mv = 0;
                for (const etf of etfs) {
                    mv += (portfolio[etf.code]?.shares || 0) * (datePrices[etf.code] || 0);
                }
                totalValue = cash + mv;

                // 6.8 对比基准净值折算
                let benchmarkValue = null;
                if (benchmarkCode && benchmarkBasePrice > 0) {
                    const bmDay = benchmarkHistory.find(h => h.tradeDate === date);
                    if (bmDay && bmDay.closePrice > 0) {
                        lastBenchmarkPrice = bmDay.closePrice;
                    }
                    benchmarkValue = parseFloat((initialCapital * (lastBenchmarkPrice / benchmarkBasePrice)).toFixed(2));
                }

                // 6.9 计算各资产占比
                const assetRatios = { cash: totalValue > 0 ? (cash / totalValue * 100) : 0 };
                for (const etf of etfs) {
                    const holding = portfolio[etf.code];
                    const p = datePrices[etf.code] || 0;
                    assetRatios[etf.code] = totalValue > 0 ? ((holding.shares * p) / totalValue * 100) : 0;
                }

                // 6.10 计算各 ETF 独立净值表现（使用价格记忆，未上市前设为 null，绝不归零）
                const etfPerformances = {};
                for (const etf of etfs) {
                    const firstP = etfFirstPrices[etf.code];
                    const curP = datePrices[etf.code] || lastValidPrices[etf.code];
                    const historyList = historyDataMap[etf.code] || [];
                    const isListedYet = historyList.length > 0 && date >= historyList[0].tradeDate;

                    if (isListedYet && firstP && curP && curP > 0) {
                        etfPerformances[etf.code] = parseFloat((initialCapital * (curP / firstP)).toFixed(2));
                    } else {
                        etfPerformances[etf.code] = null;
                    }
                }

                dailyValues.push({
                    date,
                    totalValue: parseFloat(totalValue.toFixed(2)),
                    cash: parseFloat(cash.toFixed(2)),
                    marketValue: parseFloat(mv.toFixed(2)),
                    benchmarkValue,
                    drawdown: parseFloat((-drawdown).toFixed(4)),
                    assetRatios,
                    etfPerformances
                });

                if (i > 0) {
                    const prevVal = dailyValues[i - 1]?.totalValue || initialCapital;
                    const dRet = (totalValue - prevVal) / prevVal * 100;
                    dailyReturns.push(dRet);
                }
            }

            // 7. 计算量化综合评价指标
            const finalValue = dailyValues[dailyValues.length - 1]?.totalValue || initialCapital;
            const totalReturn = (finalValue - initialCapital) / initialCapital * 100;
            const years = (new Date(endDate) - new Date(startDate)) / (365 * 24 * 60 * 60 * 1000);
            const annualReturn = calcAnnualReturn(totalReturn, Math.max(years, 0.1));
            const maxDrawdown = calcMaxDrawdown(dailyValues.map(d => d.totalValue));
            const annualVolatility = calcVolatility(dailyReturns);
            const sharpeRatio = calcSharpeRatio(annualReturn, 2.5, annualVolatility);

            // 基准综合指标
            let benchmarkMetrics = null;
            if (benchmarkCode && benchmarkHistory.length > 0) {
                const bmDailyValues = dailyValues.map(d => d.benchmarkValue).filter(v => v !== null);
                const bmDailyReturns = [];
                for (let i = 1; i < bmDailyValues.length; i++) {
                    bmDailyReturns.push(((bmDailyValues[i] - bmDailyValues[i - 1]) / bmDailyValues[i - 1]) * 100);
                }
                const firstBmPrice = parseFloat(benchmarkHistory[0].closePrice);
                const lastBmPrice = parseFloat(benchmarkHistory[benchmarkHistory.length - 1].closePrice);
                const bmTotalReturn = ((lastBmPrice - firstBmPrice) / firstBmPrice) * 100;
                const bmAnnualReturn = calcAnnualReturn(bmTotalReturn, Math.max(years, 0.1));
                const bmDrawdown = calcMaxDrawdown(bmDailyValues);
                const bmVol = calcVolatility(bmDailyReturns);
                const bmSharpe = calcSharpeRatio(bmAnnualReturn, 2.5, bmVol);

                benchmarkMetrics = {
                    name: benchmarkName,
                    totalReturn: parseFloat(bmTotalReturn.toFixed(4)),
                    annualReturn: parseFloat(bmAnnualReturn.toFixed(4)),
                    maxDrawdown: parseFloat(bmDrawdown.toFixed(4)),
                    annualVolatility: parseFloat(bmVol.toFixed(4)),
                    sharpeRatio: parseFloat(bmSharpe.toFixed(4))
                };
            }

            // 各 ETF 独立指标
            const etfMetrics = {};
            for (const etf of etfs) {
                const series = dailyValues.map(d => d.etfPerformances[etf.code]).filter(v => v !== null);
                if (series.length > 1) {
                    const firstVal = series[0];
                    const lastVal = series[series.length - 1];
                    const eTotalRet = ((lastVal - firstVal) / firstVal) * 100;
                    const eAnnualRet = calcAnnualReturn(eTotalRet, Math.max(years, 0.1));
                    const eDd = calcMaxDrawdown(series);
                    const eReturns = [];
                    for (let j = 1; j < series.length; j++) {
                        eReturns.push(((series[j] - series[j - 1]) / series[j - 1]) * 100);
                    }
                    const eVol = calcVolatility(eReturns);
                    const eSharpe = calcSharpeRatio(eAnnualRet, 2.5, eVol);

                    etfMetrics[etf.code] = {
                        name: etf.name || etf.code,
                        totalReturn: parseFloat(eTotalRet.toFixed(4)),
                        annualReturn: parseFloat(eAnnualRet.toFixed(4)),
                        maxDrawdown: parseFloat(eDd.toFixed(4)),
                        annualVolatility: parseFloat(eVol.toFixed(4)),
                        sharpeRatio: parseFloat(eSharpe.toFixed(4))
                    };
                }
            }

            // 历年盈亏统计
            const yearlyStats = this.calcYearlyStats(dailyValues, benchmarkCode);

            // 8. 组装返回结果
            const result = {
                params,
                totalReturn: parseFloat(totalReturn.toFixed(4)),
                annualReturn: parseFloat(annualReturn.toFixed(4)),
                maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
                annualVolatility: parseFloat(annualVolatility.toFixed(4)),
                sharpeRatio: parseFloat(sharpeRatio.toFixed(4)),
                finalValue: parseFloat(finalValue.toFixed(2)),
                totalTrades: tradeRecords.length,
                yearlyStats,
                benchmarkMetrics,
                etfMetrics,
                tradeRecords: tradeRecords.slice(0, 2000),
                dailyValues
            };

            // 9. 持久化存储（非寻优模式）
            if (!isOptimization) {
                try {
                    this.db.execute(`
                        INSERT INTO backtest_results (name, params, total_return, annual_return, max_drawdown, annual_volatility, sharpe_ratio, daily_detail, create_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        `回测_${startDate}_${endDate}`,
                        JSON.stringify(params),
                        result.totalReturn,
                        result.annualReturn,
                        result.maxDrawdown,
                        result.annualVolatility,
                        result.sharpeRatio,
                        JSON.stringify(result),
                        new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z/, '')
                    ]);
                } catch (saveErr) {
                    // ignore
                }
            }

            return result;
        } catch (error) {
            return { error: String(error && error.message ? error.message : error) };
        }
    }

    /**
     * 策略 A 档位研判（引入防抖缓冲区 buffer，消除临界震荡摩擦损耗）
     */
    evaluateStrategyA(config, drawdown, currentALevel, initialRatios, stepRatios = {}, buffer = 1.0) {
        const sortedLevels = [...(config.drawdownLevels || [])].sort((a, b) => b.threshold - a.threshold);
        let expectedLevel = 0;
        let expectedRatios = null;

        for (const level of sortedLevels) {
            if (drawdown >= level.threshold) {
                expectedLevel = level.levelOrder;
                const ratios = {};
                (level.ratios || []).forEach(r => {
                    const step = stepRatios[r.etfCode] || 5.0;
                    ratios[r.etfCode] = (initialRatios[r.etfCode] || 0) + (r.targetRatio * step);
                });
                expectedRatios = ratios;
                break;
            }
        }

        // 1. 档位加深（回撤加深）：严格按阈值触发加仓
        if (expectedLevel > currentALevel) {
            return {
                action: 'drawdown',
                reason: `回撤深达 ${drawdown.toFixed(2)}%，触发第 ${expectedLevel} 档加仓配置`,
                ratios: expectedRatios,
                newLevel: expectedLevel,
                resetHigh: false
            };
        }

        // 2. 档位退回（反弹收窄）：引入滞后防抖缓冲区，消除临界震荡摩擦损耗
        if (expectedLevel < currentALevel && currentALevel > 0) {
            const currentLevelCfg = sortedLevels.find(l => l.levelOrder === currentALevel);
            const currentThreshold = currentLevelCfg ? currentLevelCfg.threshold : 0;
            const exitThreshold = currentThreshold - Math.max(0, buffer);

            // 临界防抖：如果回撤仍在 [exitThreshold, currentThreshold] 之间，属于防抖滞后盲区，维持当前档位，杜绝频繁买卖
            if (drawdown >= exitThreshold) {
                return null;
            }

            if (expectedLevel === 0) {
                return {
                    action: 'rebound',
                    reason: `回撤收窄至 ${drawdown.toFixed(2)}%（有效摆脱第 1 档防抖盲区），退回初始配置比例`,
                    ratios: { ...initialRatios },
                    newLevel: 0,
                    resetHigh: false
                };
            } else {
                return {
                    action: 'rebound',
                    reason: `回撤收窄至 ${drawdown.toFixed(2)}%（有效摆脱第 ${currentALevel} 档防抖盲区），下调成第 ${expectedLevel} 档配置`,
                    ratios: expectedRatios,
                    newLevel: expectedLevel,
                    resetHigh: false
                };
            }
        }

        return null;
    }

    /**
     * 策略 B 估值偏离研判
     */
    evaluateStrategyB(config, deviation, currentLevel, initialRatios, stepRatios = {}) {
        let expectedLevel = 0;
        let expectedRatios = { ...initialRatios };
        let reason = '估值偏离回归正常范围，自动复位至初始配置比例';
        let action = 'reset';

        const sortedOvervalued = [...(config.overvaluedLevels || [])].sort((a, b) => b.levelOrder - a.levelOrder);
        for (const level of sortedOvervalued) {
            if (deviation >= level.threshold) {
                expectedLevel = level.levelOrder;
                expectedRatios = {};
                (level.ratios || []).forEach(r => {
                    const step = stepRatios[r.etfCode] || 5.0;
                    expectedRatios[r.etfCode] = (initialRatios[r.etfCode] || 0) + (r.targetRatio * step);
                });
                reason = `年化偏离度为 ${deviation.toFixed(2)}%，达到高估档位 ${level.levelOrder} (${level.threshold}%)`;
                action = 'overvalued';
                break;
            }
        }

        if (expectedLevel === 0) {
            const sortedUndervalued = [...(config.undervaluedLevels || [])].sort((a, b) => b.levelOrder - a.levelOrder);
            for (const level of sortedUndervalued) {
                if (deviation <= -level.threshold) {
                    expectedLevel = -level.levelOrder;
                    expectedRatios = {};
                    (level.ratios || []).forEach(r => {
                        const step = stepRatios[r.etfCode] || 5.0;
                        expectedRatios[r.etfCode] = (initialRatios[r.etfCode] || 0) + (r.targetRatio * step);
                    });
                    reason = `年化偏离度为 ${deviation.toFixed(2)}%，达到低估档位 ${level.levelOrder} (-${level.threshold}%)`;
                    action = 'undervalued';
                    break;
                }
            }
        }

        if (expectedLevel !== currentLevel) {
            return { action, reason, ratios: expectedRatios, newLevel: expectedLevel };
        }

        return null;
    }

    /**
     * 实盘级交易执行引擎（先卖后买、按手取整、加权平均成本）
     */
    executeTrades(portfolio, prices, targetRatios, totalValue, cash, feeRate, feeExemptFive, reason, tradeType = 'strategy') {
        if (!targetRatios || Object.keys(targetRatios).length === 0) {
            let mv = 0;
            for (const code of Object.keys(portfolio)) {
                mv += (portfolio[code]?.shares || 0) * (prices[code] || 0);
            }
            return { portfolio, cash, marketValue: mv, trades: [] };
        }

        let remainingCash = cash;
        const trades = [];
        const newPortfolio = {};
        for (const [code, holding] of Object.entries(portfolio)) {
            newPortfolio[code] = { ...holding };
        }

        const pendingTrades = [];
        for (const [code, targetRatio] of Object.entries(targetRatios)) {
            const holding = newPortfolio[code] || { shares: 0, costPrice: 0, ratio: 0, isListed: true };
            const price = prices[code] || 0;
            if (price <= 0) continue;

            const targetVal = totalValue * (targetRatio / 100);
            const currentVal = holding.shares * price;
            const diffVal = targetVal - currentVal;

            const sharesDelta = diffVal >= 0
                ? Math.floor(diffVal / price / 100) * 100
                : Math.ceil(diffVal / price / 100) * 100;

            if (sharesDelta !== 0) {
                pendingTrades.push({ code, sharesDelta, price });
            }
        }

        // 步骤 1：先执行所有卖出操作（释放现金）
        for (const trade of pendingTrades.filter(t => t.sharesDelta < 0)) {
            const holding = newPortfolio[trade.code];
            if (!holding) continue;

            const sellShares = Math.min(Math.abs(trade.sharesDelta), holding.shares);
            if (sellShares > 0) {
                const preAmount = holding.shares * trade.price;
                const preRatio = totalValue > 0 ? (preAmount / totalValue * 100) : 0;
                const amount = sellShares * trade.price;
                const fee = calcFee(amount, feeRate, feeExemptFive);

                holding.shares -= sellShares;
                const postAmount = holding.shares * trade.price;
                const postRatio = totalValue > 0 ? (postAmount / totalValue * 100) : 0;

                remainingCash += (amount - fee);
                trades.push({
                    type: tradeType, etfCode: trade.code, action: 'sell',
                    shares: sellShares, price: trade.price, amount, fee, reason,
                    preAmount, postAmount, preRatio, postRatio
                });
            }
        }

        // 步骤 2：后执行所有买入操作
        for (const trade of pendingTrades.filter(t => t.sharesDelta > 0)) {
            const holding = newPortfolio[trade.code] || (newPortfolio[trade.code] = { shares: 0, costPrice: 0, ratio: 0, isListed: true });

            const preAmount = holding.shares * trade.price;
            const preRatio = totalValue > 0 ? (preAmount / totalValue * 100) : 0;
            const amount = trade.sharesDelta * trade.price;
            const fee = calcFee(amount, feeRate, feeExemptFive);

            if (remainingCash >= amount + fee) {
                // 加权平均成本
                const totalShares = holding.shares + trade.sharesDelta;
                holding.costPrice = totalShares > 0 ? (holding.shares * holding.costPrice + trade.sharesDelta * trade.price) / totalShares : trade.price;
                holding.shares = totalShares;

                const postAmount = holding.shares * trade.price;
                const postRatio = totalValue > 0 ? (postAmount / totalValue * 100) : 0;

                remainingCash -= (amount + fee);
                trades.push({
                    type: tradeType, etfCode: trade.code, action: 'buy',
                    shares: trade.sharesDelta, price: trade.price, amount, fee, reason,
                    preAmount, postAmount, preRatio, postRatio
                });
            } else {
                // 现金不足降级买入
                const maxShares = Math.floor((remainingCash * 0.999) / trade.price / 100) * 100;
                if (maxShares >= 100) {
                    const realAmount = maxShares * trade.price;
                    const realFee = calcFee(realAmount, feeRate, feeExemptFive);
                    if (remainingCash >= realAmount + realFee) {
                        const totalShares = holding.shares + maxShares;
                        holding.costPrice = totalShares > 0 ? (holding.shares * holding.costPrice + maxShares * trade.price) / totalShares : trade.price;
                        holding.shares = totalShares;

                        const postAmount = holding.shares * trade.price;
                        const postRatio = totalValue > 0 ? (postAmount / totalValue * 100) : 0;

                        remainingCash -= (realAmount + realFee);
                        trades.push({
                            type: tradeType, etfCode: trade.code, action: 'buy',
                            shares: maxShares, price: trade.price, amount: realAmount, fee: realFee,
                            reason: reason + '(现金受限)',
                            preAmount, postAmount, preRatio, postRatio
                        });
                    }
                }
            }
        }

        let newMarketValue = 0;
        for (const [code, holding] of Object.entries(newPortfolio)) {
            const p = prices[code] || 0;
            newMarketValue += (holding.shares || 0) * p;
        }

        return { portfolio: newPortfolio, cash: remainingCash, marketValue: newMarketValue, trades };
    }

    /**
     * 参数网格寻优
     */
    async runParameterOptimization(params) {
        const { baseParams, optimizationRanges } = params;
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
                    annualVolatility: result.annualVolatility,
                    sharpeRatio: result.sharpeRatio
                });
            }
        }

        results.sort((a, b) => b.sharpeRatio - a.sharpeRatio || a.maxDrawdown - b.maxDrawdown);

        return {
            totalCombinations: combinations.length,
            sortedResults: results.slice(0, 50),
            bestParams: results[0] || null
        };
    }

    /**
     * 获取历史回测列表
     */
    async getBacktestResults() {
        return this.db.query(`
            SELECT id, name, params, total_return, annual_return, max_drawdown, annual_volatility, sharpe_ratio, create_time
            FROM backtest_results
            ORDER BY id DESC
            LIMIT 500
        `);
    }

    /**
     * 获取单次回测详情（兼容新旧数据格式，确保图表与指标全要素完整呈现）
     */
    async getBacktestDetail(id) {
        const row = this.db.queryOne(`
            SELECT * FROM backtest_results WHERE id = ?
        `, [id]);

        if (!row) return null;

        let parsedDaily = [];
        let parsedParams = {};
        if (row.daily_detail) {
            try {
                parsedDaily = typeof row.daily_detail === 'string' ? JSON.parse(row.daily_detail) : row.daily_detail;
            } catch (e) {
                parsedDaily = [];
            }
        }
        if (row.params) {
            try {
                parsedParams = typeof row.params === 'string' ? JSON.parse(row.params) : row.params;
            } catch (e) {
                parsedParams = {};
            }
        }

        // 如果已是完整对象（包含 dailyValues）
        if (parsedDaily && !Array.isArray(parsedDaily) && typeof parsedDaily === 'object' && parsedDaily.dailyValues) {
            return {
                id: row.id,
                name: row.name,
                create_time: row.create_time,
                ...parsedDaily
            };
        }

        // 如果是历史纯 dailyValues 数组格式，组装为前端统一期望的完整结果结构
        const dailyValues = Array.isArray(parsedDaily) ? parsedDaily : [];
        const yearlyStats = this.calcYearlyStats(dailyValues, parsedParams.benchmarkCode || '000300');

        let benchmarkMetrics = null;
        const etfMetrics = {};
        if (dailyValues.length > 1) {
            const startDate = dailyValues[0].date;
            const endDate = dailyValues[dailyValues.length - 1].date;
            const years = (new Date(endDate) - new Date(startDate)) / (365 * 24 * 60 * 60 * 1000);

            // 基准指标提取
            const bmDailyValues = dailyValues.map(d => d.benchmarkValue).filter(v => v !== null && v !== undefined);
            if (bmDailyValues.length > 1) {
                const bmDailyReturns = [];
                for (let i = 1; i < bmDailyValues.length; i++) {
                    bmDailyReturns.push(((bmDailyValues[i] - bmDailyValues[i - 1]) / bmDailyValues[i - 1]) * 100);
                }
                const firstBm = bmDailyValues[0];
                const lastBm = bmDailyValues[bmDailyValues.length - 1];
                const bmTot = ((lastBm - firstBm) / firstBm) * 100;
                const bmAnn = (Math.pow(1 + bmTot / 100, 1 / Math.max(years, 0.1)) - 1) * 100;

                let maxBmVal = bmDailyValues[0];
                let maxBmDd = 0;
                for (const v of bmDailyValues) {
                    if (v > maxBmVal) maxBmVal = v;
                    const dd = maxBmVal > 0 ? (maxBmVal - v) / maxBmVal * 100 : 0;
                    if (dd > maxBmDd) maxBmDd = dd;
                }

                const avg = bmDailyReturns.reduce((s, r) => s + r, 0) / bmDailyReturns.length;
                const variance = bmDailyReturns.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / (bmDailyReturns.length - 1 || 1);
                const bmVol = Math.sqrt(variance) * Math.sqrt(250);
                const bmSharpe = bmVol > 0 ? (bmAnn - 2.5) / bmVol : 0;

                benchmarkMetrics = {
                    name: '沪深300',
                    totalReturn: parseFloat(bmTot.toFixed(4)),
                    annualReturn: parseFloat(bmAnn.toFixed(4)),
                    maxDrawdown: parseFloat(maxBmDd.toFixed(4)),
                    annualVolatility: parseFloat(bmVol.toFixed(4)),
                    sharpeRatio: parseFloat(bmSharpe.toFixed(4))
                };
            }

            // 各 ETF 单独指标提取
            const firstDay = dailyValues[0];
            const codes = Object.keys(firstDay.etfPerformances || {});
            for (const code of codes) {
                const series = dailyValues.map(d => d.etfPerformances?.[code]).filter(v => v !== null && v !== undefined);
                if (series.length > 1) {
                    const firstVal = series[0];
                    const lastVal = series[series.length - 1];
                    const eTot = ((lastVal - firstVal) / firstVal) * 100;
                    const eAnn = (Math.pow(1 + eTot / 100, 1 / Math.max(years, 0.1)) - 1) * 100;

                    let maxV = series[0];
                    let maxDd = 0;
                    const eReturns = [];
                    for (let j = 0; j < series.length; j++) {
                        if (series[j] > maxV) maxV = series[j];
                        const dd = maxV > 0 ? (maxV - series[j]) / maxV * 100 : 0;
                        if (dd > maxDd) maxDd = dd;
                        if (j > 0) {
                            eReturns.push(((series[j] - series[j - 1]) / series[j - 1]) * 100);
                        }
                    }
                    const eAvg = eReturns.reduce((s, r) => s + r, 0) / eReturns.length;
                    const eVar = eReturns.reduce((s, r) => s + Math.pow(r - eAvg, 2), 0) / (eReturns.length - 1 || 1);
                    const eVol = Math.sqrt(eVar) * Math.sqrt(250);
                    const eSharpe = eVol > 0 ? (eAnn - 2.5) / eVol : 0;

                    etfMetrics[code] = {
                        name: code,
                        totalReturn: parseFloat(eTot.toFixed(4)),
                        annualReturn: parseFloat(eAnn.toFixed(4)),
                        maxDrawdown: parseFloat(maxDd.toFixed(4)),
                        annualVolatility: parseFloat(eVol.toFixed(4)),
                        sharpeRatio: parseFloat(eSharpe.toFixed(4))
                    };
                }
            }
        }

        const finalValue = dailyValues.length > 0 ? dailyValues[dailyValues.length - 1].totalValue : 1000000;

        return {
            id: row.id,
            name: row.name,
            params: parsedParams,
            totalReturn: parseFloat(row.total_return || 0),
            annualReturn: parseFloat(row.annual_return || 0),
            maxDrawdown: parseFloat(row.max_drawdown || 0),
            annualVolatility: parseFloat(row.annual_volatility || 0),
            sharpeRatio: parseFloat(row.sharpe_ratio || 0),
            finalValue,
            yearlyStats,
            benchmarkMetrics,
            etfMetrics,
            tradeRecords: [],
            dailyValues
        };
    }

    /**
     * 计算历年收益
     */
    calcYearlyStats(dailyValues, benchmarkCode) {
        const yearGroups = {};
        dailyValues.forEach(d => {
            const year = d.date.slice(0, 4);
            if (!yearGroups[year]) {
                yearGroups[year] = {
                    firstStrategy: d.totalValue,
                    lastStrategy: d.totalValue,
                    firstBenchmark: d.benchmarkValue,
                    lastBenchmark: d.benchmarkValue
                };
            }
            yearGroups[year].lastStrategy = d.totalValue;
            yearGroups[year].lastBenchmark = d.benchmarkValue;
        });

        return Object.keys(yearGroups).sort().map(year => {
            const g = yearGroups[year];
            return {
                year,
                strategyReturn: parseFloat(((g.lastStrategy - g.firstStrategy) / g.firstStrategy * 100).toFixed(2)),
                benchmarkReturn: benchmarkCode && g.firstBenchmark !== null && g.lastBenchmark !== null
                    ? parseFloat(((g.lastBenchmark - g.firstBenchmark) / g.firstBenchmark * 100).toFixed(2))
                    : null
            };
        });
    }

    /**
     * 笛卡尔积组合生成器
     */
    generateCombinations(ranges) {
        const keys = Object.keys(ranges);
        const combinations = [];

        const generate = (index, current) => {
            if (index === keys.length) {
                combinations.push(current);
                return;
            }
            const key = keys[index];
            const values = ranges[key] || [];
            for (const value of values) {
                generate(index + 1, { ...current, [key]: value });
            }
        };

        generate(0, {});
        return combinations;
    }
}

module.exports = BacktestService;
