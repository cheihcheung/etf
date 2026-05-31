const logger = require('../utils/logger');
const spider = require('./spider');
const { calcAnnualReturn, calcMaxDrawdown, calcSharpeRatio, calcVolatility } = require('../utils/helpers');

// 导入全新 MVC 模型层实体
const EtfBasic = require('../models/EtfBasic');
const EtfHistory = require('../models/EtfHistory');
const TradeRecord = require('../models/TradeRecord');
const BacktestResult = require('../models/BacktestResult');

async function runBacktest(params) {
    let {
        startDate,
        endDate,
        initialCapital = 1000000,
        feeRate = 0.03, // 前端传的是百分比，如 0.03 表示 0.03%
        feeExemptFive = true,
        etfs = [],
        initialRatios = {},
        strategyAConfig = null,
        strategyBConfig = null,
        rebalanceConfig = null,
        rebalanceThreshold = 1.5,
        tradeFrequency = 'monthly',
        strategyPriority = 'strategy_a',
        centralAnnual = 10,
        resetOnHigh = true
    } = params;

    // 0. 极其关键的静默自清洗：在回测前自动拉取所有被禁用的 ETF 资产物理剥离！
    try {
        const disabledEtfs = await EtfBasic.findAll("is_enabled = 0");
        const disabledCodes = (disabledEtfs || []).map(e => e.code);
        if (disabledCodes.length > 0) {
            etfs = etfs.filter(e => !disabledCodes.includes(e.code));
            disabledCodes.forEach(code => {
                delete initialRatios[code];
            });
            logger.info(`[回测引擎] 物理屏蔽了禁用的资产: ${disabledCodes.join(', ')}`);
        }
    } catch (dbErr) {
        logger.error(`[回测引擎] 过滤禁用资产失败: ${dbErr.message}`);
    }

    // 0.1 加载专属加减比步长映射
    const stepRatios = {};
    try {
        const allEtfs = await EtfBasic.findAll();
        (allEtfs || []).forEach(e => {
            stepRatios[e.code] = parseFloat(e.step_ratio !== null && e.step_ratio !== undefined ? e.step_ratio : 5.0);
        });
    } catch (err) {
        logger.error(`[回测引擎] 加载专属步长失败: ${err.message}`);
    }

    // 保持原始费率数值，交给 calcFee 统一处理
    const tradeFeeRate = feeRate;

    logger.info(`开始回测: ${startDate} ~ ${endDate}, 初始资金: ${initialCapital}, 频率: ${tradeFrequency}`);
    logger.info(`策略A传入参数配置: ${JSON.stringify(strategyAConfig)}`);

    // 1. 精准找到「沪深300」ETF 代码（使用 Model 优雅拉取）
    let hs300Code = '510300'; // 默认值，经数据库确认
    try {
        const hs300Etf = await EtfBasic.findOne("name LIKE '%沪深300%'");
        if (hs300Etf) {
            hs300Code = hs300Etf.code;
            logger.info(`基准代码锁定: ${hs300Code}`);
        }
    } catch (e) {
        logger.warn('查询基准代码失败，使用默认 510300');
    }

    // 2. 从本地数据库读取所有 ETF 的历史数据（与基准数据源保持一致，利用 Model 读盘）
    const historyDataMap = {};
    for (const etf of etfs) {
        try {
            const dbRows = await EtfHistory.getHistoryByRange(etf.code, startDate, endDate);
            if (dbRows && dbRows.length > 0) {
                historyDataMap[etf.code] = dbRows.map(d => {
                    let tradeDate;
                    if (d.trade_date instanceof Date) {
                        const dt = d.trade_date;
                        tradeDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                    } else {
                        tradeDate = String(d.trade_date).slice(0, 10);
                    }
                    return {
                        tradeDate,
                        closePrice: parseFloat(d.close_price),
                        openPrice: parseFloat(d.open_price || 0)
                    };
                });
                logger.info(`从本地加载 ${etf.code} 历史数据: ${dbRows.length} 条，最早: ${historyDataMap[etf.code][0].tradeDate}`);
            } else {
                // 本地无数据，回退到爬虫（会有数据范围限制）
                logger.warn(`本地无 ${etf.code} 数据，回退到爬虫接口`);
                const rawData = await spider.fetchETFHistoryData(etf.code, startDate, endDate);
                historyDataMap[etf.code] = rawData.map(d => ({ ...d, tradeDate: String(d.tradeDate).slice(0, 10), closePrice: parseFloat(d.closePrice) }));
            }
        } catch (e) {
            logger.error(`加载 ${etf.code} 数据失败: ${e.message}`);
            historyDataMap[etf.code] = [];
        }
    }

    // 3. 从本地数据库读取基准数据，使用 Model 层优雅检索
    let hs300History = [];
    try {
        const dbRows = await EtfHistory.getHistoryByRange(hs300Code, startDate, endDate);
        if (dbRows && dbRows.length > 0) {
            hs300History = dbRows.map(r => {
                let tradeDate;
                if (r.trade_date instanceof Date) {
                    const d = r.trade_date;
                    tradeDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                } else {
                    tradeDate = String(r.trade_date).slice(0, 10);
                }
                return { tradeDate, closePrice: parseFloat(r.close_price) };
            });
            logger.info(`从本地加载 ${hs300Code} 基准数据: ${hs300History.length} 条，最早: ${hs300History[0].tradeDate}`);
        } else {
            logger.warn(`本地无 ${hs300Code} 数据，回退到接口`);
            hs300History = await spider.fetchHS300History(startDate, endDate);
        }
    } catch (e) {
        logger.error('读取基准数据失败: ' + e.message);
        hs300History = await spider.fetchHS300History(startDate, endDate);
    }

    // 4. 生成全局日期轴（强制以 HS300 的日期或用户请求的日期为底座）
    const allDates = new Set();
    hs300History.forEach(h => allDates.add(h.tradeDate));
    Object.values(historyDataMap).forEach(data => {
        data.forEach(d => allDates.add(d.tradeDate));
    });

    // 如果没有任何数据日期，补上开始和结束日期作为兜底
    if (allDates.size === 0) {
        allDates.add(startDate);
        allDates.add(endDate);
    }

    const sortedDates = Array.from(allDates).sort();

    if (sortedDates.length === 0) {
        return { error: '未获取到任何历史数据，请先同步行情数据' };
    }

    let cash = initialCapital;
    let portfolio = {};
    let totalValue = initialCapital;
    let dailyValues = [];
    let dailyReturns = [];
    let tradeRecords = [];
    let historyHighValue = initialCapital;
    let currentALevel = 0;
    let currentBLevel = 0;

    // 持久化当前激活的目标比例，默认为初始比例
    let activeTargetRatios = { ...initialRatios };

    // 价格记忆：记录每个 ETF 的最后有效价格
    let lastValidPrices = {};
    // HS300 价格记忆 & 基准首价
    let lastHs300Price = hs300History.length > 0 ? hs300History[0].closePrice : 0;
    const hs300BasePrice = lastHs300Price;

    // ==========================================================
    // 1. 初始化持仓结构
    // ==========================================
    // 为每个配置了回测的 ETF 建立基础持仓状态，默认份额为 0，成本为 0
    for (const etf of etfs) {
        portfolio[etf.code] = { shares: 0, costPrice: 0, ratio: 0 };
    }

    // ==========================================
    // 2. 初始建仓（仅针对回测首日已上市的标的）
    // ==========================================
    // 核心漏洞修复：只在回测第一天（已上市且有价格）建仓，未上市标的留存现金等待延迟建仓，杜绝未来数据穿越
    const firstTradeDate = sortedDates[0];
    for (const etf of etfs) {
        const ratio = initialRatios[etf.code] || 0;
        if (ratio <= 0) continue; // 比例为0的标的不予配资

        const data = historyDataMap[etf.code] || [];
        // 查找该 ETF 在回测首日当天的行情数据
        const firstDayData = data.find(d => d.tradeDate === firstTradeDate);

        // 如果在回测首日能获取到有效收盘价，说明该资产已上市，立即执行首日初始建仓
        if (firstDayData && firstDayData.closePrice > 0) {
            const price = firstDayData.closePrice;
            const targetValue = initialCapital * (ratio / 100); // 算出目标资产配置金额
            const shares = Math.floor(targetValue / price / 100) * 100; // 按 100 股（一手）向下取整计算买入股数
            const amount = shares * price;
            const fee = calcFee(amount, tradeFeeRate, feeExemptFive); // 计算交易费用（含最低单笔5元限制）

            portfolio[etf.code] = { shares, costPrice: price, ratio };
            cash -= (amount + fee); // 从现金账户扣款
            lastValidPrices[etf.code] = price; // 记忆当前有效价格

            logger.info(`[初始建仓] 标的 ${etf.code} 于首日 ${firstTradeDate} 建仓成功，单价: ${price}，建仓份额: ${shares} 股`);
            tradeRecords.push({
                date: firstTradeDate,
                type: 'init',
                etfCode: etf.code,
                action: 'buy',
                shares,
                price,
                amount,
                fee,
                reason: '初始建仓',
                totalValue: initialCapital,
                preAmount: 0,
                postAmount: amount,
                preRatio: 0,
                postRatio: initialCapital > 0 ? (amount / initialCapital * 100) : 0
            });
        } else {
            // 若首日未上市，不做任何扣款，初始化份额为0。后续该标的在主循环中上市时，会自动触发延迟建仓
            logger.warn(`[初始建仓] 标的 ${etf.code} 在首日 ${firstTradeDate} 尚未上市或无有效价格，将延迟至其上市首日自动补仓`);
            portfolio[etf.code] = { shares: 0, costPrice: 0, ratio: 0 };
        }
    }

    // ==========================================
    // 3. 回测时间轴主循环（逐日流动计算）
    // ==========================================
    for (let i = 0; i < sortedDates.length; i++) {
        const date = sortedDates[i];
        let datePrices = {};

        // 3.1 获取并更新当日所有标的的最新价格，维护价格记忆
        for (const etf of etfs) {
            const data = historyDataMap[etf.code] || [];
            const dayData = data.find(d => d.tradeDate === date);

            if (dayData && dayData.closePrice > 0) {
                datePrices[etf.code] = dayData.closePrice;
                lastValidPrices[etf.code] = dayData.closePrice; // 保持最新有效价格记忆
            } else {
                // 如果当日停牌、非交易日或未上市，价格沿用历史最新的有效价格记忆
                datePrices[etf.code] = lastValidPrices[etf.code] || 0;
            }
        }

        // 3.2 延迟补仓（针对上市首日的标的）
        let totalMarketValue = 0;
        for (const etf of etfs) {
            const holding = portfolio[etf.code];
            const price = datePrices[etf.code] || 0;

            // 自动补仓：如果该标的前期未上市（shares === 0），而今天上市首日有了有效价格（price > 0），则按初始占比建仓
            if (holding && holding.shares === 0 && price > 0) {
                const ratio = initialRatios[etf.code] || 0;
                if (ratio > 0) {
                    const targetValue = totalValue * (ratio / 100);
                    const shares = Math.floor(targetValue / price / 100) * 100;
                    if (shares > 0) {
                        const amount = shares * price;
                        const fee = calcFee(amount, tradeFeeRate, feeExemptFive);
                        if (cash >= amount + fee) {
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
                            logger.info(`[延迟建仓] 标的 ${etf.code} 于上市首日 ${date} 自动补仓成功，单价: ${price}，建仓份额: ${shares} 股`);
                        }
                    }
                }
            }

            // 累加计算当日持仓总市值
            if (holding && price > 0) {
                totalMarketValue += holding.shares * price;
            }
        }
        
        // 当日资产组合总市值 = 现金 + 持仓总市值
        totalValue = cash + totalMarketValue;

        // 3.3 更新历史净值最高点
        if (totalValue > historyHighValue) {
            historyHighValue = totalValue;
        }

        // 3.4 计算当前回撤幅度(%)
        const drawdown = historyHighValue > 0 ? (historyHighValue - totalValue) / historyHighValue * 100 : 0;

        // 3.5 判断今天是否为设定频率下的交易/调仓评估日
        let isTradeDay = false;
        if (tradeFrequency === 'daily') {
            isTradeDay = true;
        } else if (tradeFrequency === 'weekly') {
            const d = new Date(date);
            // 周五或者历史日期的最后一天
            if (d.getDay() === 5 || i === sortedDates.length - 1) isTradeDay = true;
        } else if (tradeFrequency === 'monthly') {
            const d = new Date(date);
            const nextDate = sortedDates[i + 1];
            // 若明天是下个月，或者是历史记录的最后一天
            if (!nextDate || new Date(nextDate).getMonth() !== d.getMonth()) isTradeDay = true;
        }

        // 3.6 执行策略与调仓研判
        if (isTradeDay) {
            let aResult = null;
            let bResult = null;

            // ----------------------------------------
            // 策略 A 研判模块（净值高低点回撤/反弹档位策略）
            // ----------------------------------------
            if (strategyAConfig) {
                const configWithOverride = { ...strategyAConfig, resetOnHigh };
                
                // 创新高自动复位检测（最高优先级）
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
                    aResult = evaluateStrategyA(
                        configWithOverride, drawdown, historyHighValue, 
                        totalValue, currentALevel, initialRatios, stepRatios
                    );
                }
            }

            // ----------------------------------------
            // 策略 B 研判模块（长期中枢偏离估值策略）
            // ----------------------------------------
            if (strategyBConfig) {
                const totalReturn = (totalValue - initialCapital) / initialCapital * 100;
                // 计算当前持有的实际年数，用于年化计算
                const yearsCount = (new Date(date) - new Date(startDate)) / (365 * 24 * 60 * 60 * 1000);
                const currentAnnualReturn = calcAnnualReturn(totalReturn, Math.max(yearsCount, 0.1));

                const configWithOverride = { ...strategyBConfig, centralAnnual };
                const deviation = currentAnnualReturn - configWithOverride.centralAnnual;

                bResult = evaluateStrategyB(configWithOverride, deviation, currentBLevel, initialRatios, stepRatios);
            }

            // ----------------------------------------
            // 决策融合引擎（核心重构：先合并研判决策，后一次性交易）
            // ----------------------------------------
            // 解决多策略在同一天触发冲突导致资产擦除及多重扣费的漏洞
            let chosenResult = null;
            let chosenStrategy = '';

            if (aResult && bResult) {
                // 两者在同一交易日同时被触发，采用用户预设的优先级机制
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

            // 如果有被选中的策略需要执行，立即执行一次性仓位对齐调仓
            if (chosenResult) {
                if (chosenStrategy === 'strategy_a') {
                    activeTargetRatios = chosenResult.action === 'reset' ? { ...initialRatios } : chosenResult.ratios;
                    const tradeResults = executeTrades(
                        portfolio, datePrices, activeTargetRatios, totalValue, cash, 
                        tradeFeeRate, feeExemptFive, chosenResult.reason, 'strategy_a'
                    );
                    
                    if (tradeResults.trades.length > 0) {
                        portfolio = tradeResults.portfolio;
                        cash = tradeResults.cash;
                        totalValue = cash + tradeResults.marketValue;
                        tradeRecords.push(...tradeResults.trades.map(t => ({ ...t, date, totalValue })));
                        currentALevel = chosenResult.newLevel; // 推进策略 A 档位级别
                        
                        if (chosenResult.resetHigh) {
                            historyHighValue = totalValue;
                        }
                    }
                } else if (chosenStrategy === 'strategy_b') {
                    activeTargetRatios = chosenResult.ratios;
                    const tradeResults = executeTrades(
                        portfolio, datePrices, activeTargetRatios, totalValue, cash, 
                        tradeFeeRate, feeExemptFive, chosenResult.reason, 'strategy_b'
                    );
                    
                    if (tradeResults.trades.length > 0) {
                        portfolio = tradeResults.portfolio;
                        cash = tradeResults.cash;
                        totalValue = cash + tradeResults.marketValue;
                        tradeRecords.push(...tradeResults.trades.map(t => ({ ...t, date, totalValue })));
                        currentBLevel = chosenResult.newLevel; // 推进策略 B 档位级别
                    }
                }
            }

            // ----------------------------------------
            // 日常再平衡研判模块（核心逻辑规范化修复）
            // ----------------------------------------
            // 漏洞修复：将不合规的“极差触发”修正为标准的“任意单标的实际占比偏离当前目标比例达到阈值”即触发日常再平衡
            if (rebalanceConfig && rebalanceThreshold > 0) {
                let needRebalanceTrigger = false;
                let maxDeviationInfo = '';

                for (const etf of etfs) {
                    const price = datePrices[etf.code] || 0;
                    if (price <= 0) continue; // 未上市或当日停牌，不参与偏离研判

                    const currentRatio = (portfolio[etf.code].shares * price) / totalValue * 100;
                    const targetRatio = activeTargetRatios[etf.code] || 0;
                    const dev = Math.abs(currentRatio - targetRatio);

                    // 只要发现任意一个标的的偏离度达到了设定的再平衡偏离阈值，就触发调仓
                    if (dev >= rebalanceThreshold) {
                        needRebalanceTrigger = true;
                        maxDeviationInfo = `标的 ${etf.code} 实际占比 ${currentRatio.toFixed(2)}% 偏离目标 ${targetRatio.toFixed(2)}% (超差 ${dev.toFixed(2)}%)`;
                        break;
                    }
                }

                // 触发日常再平衡交易，一键对齐到当前生效的目标配置比例上
                if (needRebalanceTrigger) {
                    const rebalRes = executeTrades(
                        portfolio, datePrices, activeTargetRatios, totalValue, cash,
                        tradeFeeRate, feeExemptFive,
                        `日常再平衡(${maxDeviationInfo})`, 'rebalance'
                    );
                    
                    if (rebalRes.trades.length > 0) {
                        portfolio = rebalRes.portfolio;
                        cash = rebalRes.cash;
                        totalValue = cash + rebalRes.marketValue;
                        tradeRecords.push(...rebalRes.trades.map(t => ({ ...t, date, totalValue })));

                        // 如果日常再平衡完后的目标比例正好是初始基础比例，自动重置策略的档位级别，恢复新一轮研判
                        const isBackToInitial = Object.keys(activeTargetRatios).every(code => 
                            Math.abs(activeTargetRatios[code] - initialRatios[code]) < 0.01
                        );
                        if (isBackToInitial) {
                            currentALevel = 0;
                            currentBLevel = 0;
                        }
                    }
                }
            }
        }

        // 更新总市值
        let mv = 0;
        for (const etf of etfs) {
            mv += (portfolio[etf.code]?.shares || 0) * (datePrices[etf.code] || 0);
        }
        totalValue = cash + mv;

        // HS300 基准价：精确匹配当日，找不到则用价格记忆（不回退到0）
        const hs300Day = hs300History.find(h => h.tradeDate === date);
        if (hs300Day && hs300Day.closePrice > 0) {
            lastHs300Price = hs300Day.closePrice;
        }
        const hs300Value = hs300BasePrice > 0 ? parseFloat((initialCapital * (lastHs300Price / hs300BasePrice)).toFixed(2)) : initialCapital;

        // 记录每日资产占比详情，用于前端面积图
        const assetRatios = { cash: (cash / totalValue * 100) };
        for (const etf of etfs) {
            const holding = portfolio[etf.code];
            const price = datePrices[etf.code] || 0;
            assetRatios[etf.code] = totalValue > 0 ? (holding.shares * price / totalValue * 100) : 0;
        }

        dailyValues.push({
            date,
            totalValue,
            cash,
            marketValue: totalMarketValue,
            hs300Value,
            drawdown: -drawdown,
            assetRatios
        });

        if (i > 0) {
            const prevValue = dailyValues[i - 1]?.totalValue || initialCapital;
            const dailyReturn = (totalValue - prevValue) / prevValue * 100;
            dailyReturns.push(dailyReturn);
        }
    }

    const finalTotalValue = dailyValues[dailyValues.length - 1]?.totalValue || initialCapital;
    const totalReturn = (finalTotalValue - initialCapital) / initialCapital * 100;
    const years = (new Date(endDate) - new Date(startDate)) / (365 * 24 * 60 * 60 * 1000);
    const annualReturn = calcAnnualReturn(totalReturn, years);
    const maxDrawdown = calcMaxDrawdown(dailyValues.map(d => d.totalValue));
    const annualVolatility = calcVolatility(dailyReturns);
    const sharpeRatio = calcSharpeRatio(annualReturn, 2.5, annualVolatility);

    // 计算沪深300全套指标
    const hs300Values = dailyValues.map(d => d.hs300Value);
    const hs300DailyReturns = [];
    for (let i = 1; i < hs300Values.length; i++) {
        const r = (hs300Values[i] - hs300Values[i - 1]) / hs300Values[i - 1] * 100;
        hs300DailyReturns.push(r);
    }
    const hs300TotalReturn = hs300Values.length > 0 ? (hs300Values[hs300Values.length - 1] - initialCapital) / initialCapital * 100 : 0;
    const hs300AnnualReturn = calcAnnualReturn(hs300TotalReturn, years);
    const hs300MaxDrawdown = calcMaxDrawdown(hs300Values);
    const hs300Volatility = calcVolatility(hs300DailyReturns);
    const hs300SharpeRatio = calcSharpeRatio(hs300AnnualReturn, 2.5, hs300Volatility);

    // 1. 为每个 ETF 建立一个标准化日期的价格查找表，并记录初始价格
    const etfPriceMaps = {};
    const etfFirstPrices = {};
    etfs.forEach(etf => {
        const history = historyDataMap[etf.code] || [];
        const priceMap = new Map();
        let firstPrice = 0;

        history.forEach(h => {
            const dateStr = typeof h.tradeDate === 'string' ? h.tradeDate.slice(0, 10) : new Date(h.tradeDate).toISOString().slice(0, 10);
            if (h.closePrice > 0) {
                priceMap.set(dateStr, h.closePrice);
                if (firstPrice === 0) firstPrice = h.closePrice;
            }
        });

        etfPriceMaps[etf.code] = priceMap;
        etfFirstPrices[etf.code] = firstPrice;
    });

    const etfMetrics = {};
    for (const etf of etfs) {
        const priceMap = etfPriceMaps[etf.code];
        const etfValues = dailyValues.map(d => {
            const p = priceMap.get(d.date.slice(0, 10)) || etfFirstPrices[etf.code];
            return initialCapital * (p / etfFirstPrices[etf.code]);
        });
        
        const etfTotalReturn = (etfValues[etfValues.length - 1] - initialCapital) / initialCapital * 100;
        const etfAnnualReturn = calcAnnualReturn(etfTotalReturn, years);
        const etfMaxDrawdown = calcMaxDrawdown(etfValues);
        
        const etfDailyReturns = [];
        for (let i = 1; i < etfValues.length; i++) {
            etfDailyReturns.push((etfValues[i] - etfValues[i - 1]) / etfValues[i - 1] * 100);
        }
        const etfVolatility = calcVolatility(etfDailyReturns);
        const etfSharpe = calcSharpeRatio(etfAnnualReturn, 2.5, etfVolatility);

        etfMetrics[etf.code] = {
            name: etf.name,
            totalReturn: parseFloat(etfTotalReturn.toFixed(4)),
            annualReturn: parseFloat(etfAnnualReturn.toFixed(4)),
            maxDrawdown: parseFloat(etfMaxDrawdown.toFixed(4)),
            annualVolatility: parseFloat(etfVolatility.toFixed(4)),
            sharpeRatio: parseFloat(etfSharpe.toFixed(4))
        };
    }

    const etfCurrentLastPrices = {};

    const result = {
        params,
        totalReturn: parseFloat(totalReturn.toFixed(4)),
        annualReturn: parseFloat(annualReturn.toFixed(4)),
        maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
        annualVolatility: parseFloat(annualVolatility.toFixed(4)),
        sharpeRatio: parseFloat(sharpeRatio.toFixed(4)),
        finalValue: parseFloat(finalTotalValue.toFixed(2)),
        totalTrades: tradeRecords.length,
        benchmarkMetrics: {
            totalReturn: parseFloat(hs300TotalReturn.toFixed(4)),
            annualReturn: parseFloat(hs300AnnualReturn.toFixed(4)),
            maxDrawdown: parseFloat(hs300MaxDrawdown.toFixed(4)),
            annualVolatility: parseFloat(hs300Volatility.toFixed(4)),
            sharpeRatio: parseFloat(hs300SharpeRatio.toFixed(4)),
        },
        etfMetrics, // 包含每个ETF的独立指标
        tradeRecords: tradeRecords.slice(0, 2000),
        dailyValues: dailyValues.map(d => {
            const etfPerformances = {};
            const currentDateStr = d.date.slice(0, 10);

            for (const etf of etfs) {
                const priceMap = etfPriceMaps[etf.code];
                const dayPrice = priceMap.get(currentDateStr);

                if (dayPrice && dayPrice > 0) {
                    etfCurrentLastPrices[etf.code] = dayPrice;
                }

                const firstPrice = etfFirstPrices[etf.code];
                const currentPrice = etfCurrentLastPrices[etf.code];

                if (firstPrice && currentPrice) {
                    etfPerformances[etf.code] = parseFloat((initialCapital * (currentPrice / firstPrice)).toFixed(2));
                } else {
                    etfPerformances[etf.code] = null;
                }
            }
            return {
                ...d,
                totalValue: parseFloat(Number(d.totalValue).toFixed(2)),
                cash: parseFloat(Number(d.cash).toFixed(2)),
                marketValue: parseFloat(Number(d.marketValue).toFixed(2)),
                hs300Value: parseFloat(Number(d.hs300Value).toFixed(2)),
                drawdown: parseFloat(Number(d.drawdown).toFixed(4)),
                etfPerformances
            };
        })
    };

    try {
        const isOptimization = params.isOptimization === true;
        
        // 核心适配：完美调用 BacktestResult 模型一键安全保存回测结果！
        await BacktestResult.saveResult(
            isOptimization ? `寻优_${startDate}_${endDate}` : `回测_${startDate}_${endDate}`,
            params,
            result.totalReturn,
            result.annualReturn,
            result.maxDrawdown,
            result.annualVolatility,
            result.sharpeRatio,
            isOptimization ? null : result // 寻优时传 null，单次精细回测时传 result 序列化
        );

        // 仅在单次精细回测时才写入具体的交易日志，参数寻优遍历时跳过，避免写入几十万条垃圾流水
        if (!isOptimization) {
            for (const t of tradeRecords.slice(0, 500)) {
                // 核心适配：完美使用 TradeRecord.logTrade 模型记录调仓流水，杜绝 ON DUPLICATE KEY / Raw SQL
                const existing = await TradeRecord.findOne({
                    trade_time: t.date,
                    etf_code: t.etfCode,
                    trade_direction: t.action
                });
                if (!existing) {
                    await TradeRecord.logTrade(
                        t.date,
                        t.etfCode,
                        t.action,
                        t.shares,
                        t.price,
                        t.amount,
                        t.fee || 0,
                        t.reason,
                        t.type || 'backtest'
                    );
                }
            }
        }
    } catch (error) {
        logger.error(`保存回测结果失败: ${error.message}`);
    }

    logger.info(`回测完成: 总收益${totalReturn.toFixed(2)}%, 年化${annualReturn.toFixed(2)}%, 最大回撤${maxDrawdown.toFixed(2)}%`);
    return result;
}

async function runParameterOptimization(params) {
    const { baseParams, optimizationRanges } = params;
    const results = [];
    let totalCombinations = 1;

    const rangeKeys = Object.keys(optimizationRanges);
    for (const key of rangeKeys) {
        totalCombinations *= optimizationRanges[key].length;
    }

    logger.info(`参数寻优开始，共${totalCombinations}种组合`);

    async function iterateRanges(currentParams, depth) {
        if (depth >= rangeKeys.length) {
            // 参数寻优时传入 isOptimization: true，避免高频写入每日明细和海量流水，根绝磁盘爆满
            const result = await runBacktest({ ...baseParams, ...currentParams, isOptimization: true });
            results.push({ params: { ...currentParams }, ...result });
            return;
        }

        const key = rangeKeys[depth];
        for (const value of optimizationRanges[key]) {
            currentParams[key] = value;
            await iterateRanges({ ...currentParams }, depth + 1);

            if (results.length % 10 === 0) {
                logger.info(`参数寻优进度: ${results.length}/${totalCombinations}`);
            }
        }
    }

    await iterateRanges({}, 0);

    results.sort((a, b) => b.annualReturn - a.annualReturn || a.maxDrawdown - b.maxDrawdown);

    logger.info(`参数寻优完成，共${results.length}种组合`);
    return {
        totalCombinations: results.length,
        sortedResults: results.slice(0, 50),
        bestParams: results[0] || null
    };
}

function evaluateStrategyA(config, drawdown, historyHigh, currentValue, currentALevel, initialRatios, stepRatios = {}) {
    // 1. 创新高复位逻辑 (最高优先级)
    if (config.resetOnHigh && currentValue >= historyHigh && historyHigh > 0) {
        if (currentALevel !== 0) {
            return {
                action: 'reset',
                reason: '组合净值创历史新高（正收益），自动复位至初始配置比例',
                ratios: { ...initialRatios },
                newLevel: 0,
                resetHigh: true
            };
        }
        return null;
    }

    // 2. 按回撤幅度寻找当前满足的最高回撤档位（回撤幅度按 threshold 从大到小排序）
    const sortedLevels = (config.drawdownLevels || []).sort((a, b) => b.threshold - a.threshold);
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

    // 3. 档位加深判定（下跌加仓）
    if (expectedLevel > currentALevel) {
        return {
            action: 'drawdown',
            reason: `回撤深达 ${drawdown.toFixed(2)}%，触发第 ${expectedLevel} 档加仓配置`,
            ratios: expectedRatios,
            newLevel: expectedLevel,
            resetHigh: false
        };
    }

    // 4. 反弹跨级退档判定（多跨一档才开始调仓，非零不回归初始）
    if (currentALevel > 0 && drawdown > 0) {
        const shallowerLevelOrder = currentALevel - 1;
        if (shallowerLevelOrder > 0) {
            // 获取更浅一档的加仓阈值
            const targetLevelConfig = (config.drawdownLevels || []).find(l => l.levelOrder === shallowerLevelOrder);
            if (targetLevelConfig && drawdown < targetLevelConfig.threshold) {
                const ratios = {};
                (targetLevelConfig.ratios || []).forEach(r => { 
                    const step = stepRatios[r.etfCode] || 5.0;
                    ratios[r.etfCode] = (initialRatios[r.etfCode] || 0) + (r.targetRatio * step); 
                });
                return {
                    action: 'rebound',
                    reason: `回撤收窄至 ${drawdown.toFixed(2)}%（涨至第 ${shallowerLevelOrder} 档阈值以内），下调成第 ${shallowerLevelOrder} 档配置`,
                    ratios,
                    newLevel: shallowerLevelOrder,
                    resetHigh: false
                };
            }
        }
    }

    return null; // 属于反弹不够或中间震荡，坚守当前档位不调仓
}

function evaluateStrategyB(config, deviation, currentLevel, initialRatios, stepRatios = {}) {
    let expectedLevel = 0;
    let expectedRatios = { ...initialRatios };
    let reason = '估值偏离回归正常范围，自动复位至初始配置比例';
    let action = 'reset';

    // 查找当前偏差满足的最高高估档位
    const sortedOvervalued = (config.overvaluedLevels || []).sort((a, b) => b.levelOrder - a.levelOrder);
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

    // 如果没有满足的高估档位，查找满足的最高低估档位
    if (expectedLevel === 0) {
        const sortedUndervalued = (config.undervaluedLevels || []).sort((a, b) => b.levelOrder - a.levelOrder);
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

    // 核心重构：只有在档位级别发生变化时，才触发调仓交易！
    // 完美支持高估与低估档位间的动态升降、按偏离幅度自然退档以及 Level 0 完美复位，打通状态锁死
    if (expectedLevel !== currentLevel) {
        return {
            action,
            reason,
            ratios: expectedRatios,
            newLevel: expectedLevel
        };
    }

    return null;
}

function executeTrades(portfolio, prices, targetRatios, totalValue, cash, feeRate, feeExemptFive, reason, tradeType = 'strategy') {
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

    // ==========================================
    // 1. 计算所有标的的买卖份额需求
    // ==========================================
    const pendingTrades = [];
    for (const [code, targetRatio] of Object.entries(targetRatios)) {
        const holding = newPortfolio[code] || { shares: 0, costPrice: 0, ratio: 0 };
        const price = prices[code] || 0;
        if (price <= 0) continue; // 忽略没有定价的停牌或未上市标的

        const targetValue = totalValue * (targetRatio / 100); // 算出根据当前目标比例对应的目标价值金额
        const currentValue = holding.shares * price; // 算出当前持仓实际价值
        const diffValue = targetValue - currentValue; // 计算目标与实际的偏离价值

        // 漏洞修复：区分买入和卖出交易的方向
        // 买入时（diffValue >= 0），向下取整（Math.floor）防止可用现金超支透支
        // 卖出时（diffValue < 0），向零/向上取整（Math.ceil）防止超额超卖（例如-1.5手向上取整为-1手，不发生过度抛售）
        // 单笔交易最少为 100 股（1手）的一倍数
        const sharesDelta = diffValue >= 0 
            ? Math.floor(diffValue / price / 100) * 100 
            : Math.ceil(diffValue / price / 100) * 100;

        if (sharesDelta !== 0) {
            pendingTrades.push({ code, sharesDelta, price });
        }
    }

    // 2. 先执行所有卖出操作 (sharesDelta < 0)
    for (const trade of pendingTrades.filter(t => t.sharesDelta < 0)) {
        const holding = newPortfolio[trade.code];
        if (!holding) continue;

        const sellShares = Math.min(Math.abs(trade.sharesDelta), holding.shares);
        if (sellShares > 0) {
            const preAmount = holding.shares * trade.price;
            const preRatio = (preAmount / totalValue) * 100;
            const amount = sellShares * trade.price;
            const fee = calcFee(amount, feeRate, feeExemptFive);

            holding.shares -= sellShares;
            const postAmount = holding.shares * trade.price;
            const postRatio = (postAmount / totalValue) * 100;

            remainingCash += (amount - fee);
            trades.push({
                type: tradeType, etfCode: trade.code, action: 'sell',
                shares: sellShares, price: trade.price, amount, fee, reason,
                preAmount, postAmount, preRatio, postRatio
            });
        }
    }

    // 3. 后执行所有买入操作 (sharesDelta > 0)
    for (const trade of pendingTrades.filter(t => t.sharesDelta > 0)) {
        const holding = newPortfolio[trade.code] || (newPortfolio[trade.code] = { shares: 0, costPrice: 0, ratio: 0 });

        const preAmount = holding.shares * trade.price;
        const preRatio = (preAmount / totalValue) * 100;
        const amount = trade.sharesDelta * trade.price;
        const fee = calcFee(amount, feeRate, feeExemptFive);

        if (remainingCash >= amount + fee) {
            holding.shares += trade.sharesDelta;
            holding.costPrice = trade.price;

            const postAmount = holding.shares * trade.price;
            const postRatio = (postAmount / totalValue) * 100;

            remainingCash -= (amount + fee);
            trades.push({
                type: tradeType, etfCode: trade.code, action: 'buy',
                shares: trade.sharesDelta, price: trade.price, amount, fee, reason,
                preAmount, postAmount, preRatio, postRatio
            });
        } else {
            const maxShares = Math.floor((remainingCash * 0.999) / trade.price / 100) * 100;
            if (maxShares >= 100) {
                const realAmount = maxShares * trade.price;
                const realFee = calcFee(realAmount, feeRate, feeExemptFive);
                if (remainingCash >= realAmount + realFee) {
                    holding.shares += maxShares;
                    const postAmount = holding.shares * trade.price;
                    const postRatio = (postAmount / totalValue) * 100;

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
        const price = prices[code] || 0;
        newMarketValue += (holding.shares || 0) * price;
    }

    return { portfolio: newPortfolio, cash: remainingCash, marketValue: newMarketValue, trades };
}

function isActionConflicted(aResult, bResult) {
    if (!aResult || !bResult) return false;
    if (aResult.action === 'reset') return true;
    return aResult.action !== bResult.action;
}

function calcFee(amount, rate, exemptFive) {
    // 交易费率：金额 * 费率(%) / 100
    let fee = amount * (rate / 100);
    // 如果不免五，单笔最低收 5 元
    if (!exemptFive && fee < 5) {
        fee = 5;
    }
    // 四舍五入到 2 位小数（分）
    return Math.round(fee * 100) / 100;
}

async function getBacktestResults() {
    return await BacktestResult.getRankings();
}

async function getBacktestDetail(id) {
    return await BacktestResult.find(id);
}

module.exports = {
    runBacktest,
    runParameterOptimization,
    getBacktestResults,
    getBacktestDetail
};
