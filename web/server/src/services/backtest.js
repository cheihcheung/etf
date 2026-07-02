/**
 * ==========================================================================================
 * 多资产策略回测系统 —— 回测引擎核心模块
 * ==========================================================================================
 * 本文件是整个系统最核心的业务文件，承担「历史行情 → 组合回测 → 量化指标计算 → 结果持久化」的完整闭环。
 *
 * 【整体架构与数据流】
 *   routes/backtest.js (HTTP 入口)
 *        │  POST /api/backtest/run  →  runBacktest(params)
 *        ▼
 *   ┌──────────────────── runBacktest 主流程 ────────────────────┐
 *   │ 0. 静默自清洗：剥离被禁用(is_enabled=0)的 ETF              │
 *   │ 0.1 加载每个 ETF 的「加减比步长」step_ratio                 │
 *   │ 1. 锁定沪深300基准代码(默认510300)                          │
 *   │ 2. 从本地 DB 读取历史行情，缺失则回退爬虫 spider            │
 *   │ 3. 读取沪深300基准历史，缺失则回退爬虫                      │
 *   │ 4. 合并所有标的 + 基准的交易日期，生成全局日期轴            │
 *   │ 5. 首日初始建仓(按手数向下取整，未上市则延迟)               │
 *   │ 6. 逐日主循环：                                            │
 *   │      6.1 更新当日价格 + 价格记忆(停牌沿用历史价)            │
 *   │      6.2 延迟补仓(上市首日自动建仓)                        │
 *   │      6.3 更新历史净值高点 + 计算回撤                       │
 *   │      6.4 判断当日是否为调仓评估日(daily/weekly/monthly)    │
 *   │      6.5 策略A(回撤分档) + 策略B(年化中枢偏离) 研判        │
 *   │      6.6 决策融合(再平衡优先裁决 / 策略优先级) + executeTrades │
 *   │      6.7 日常再平衡(任意标的偏离阈值即触发)                │
 *   │      6.8 记录每日净值/现金/市值/占比                        │
 *   │ 7. 计算: 策略组合 / 沪深300 / 每只ETF 独立的全套量化指标   │
 *   │ 8. 持久化: BacktestResult.saveResult + TradeRecord.logTrade │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * 【关键数据结构约定】
 *   - initialRatios   : { '510300': 30, '511260': 70 }  —— 初始目标占比(百分数)
 *   - strategyAConfig : { drawdownLevels:[{levelOrder,threshold,ratios}], rallyLevels:[...], resetOnHigh }
 *   - strategyBConfig : { overvaluedLevels:[...], undervaluedLevels:[...], centralAnnual }
 *   - ⚠️ ratios 格式约定: 必须是数组 [{etfCode, targetRatio}]，其中 targetRatio 是「倍数」语义
 *     实际占比 = initialRatio[etfCode] + targetRatio × step_ratio[etfCode]
 *     (例如 初始30% + 倍数1 × 步长5% = 35%)
 *
 * 【已知简化与注意事项】(详见各处 ⚠️ 标注)
 *   - 建仓/调仓使用收盘价(closePrice)，真实交易无法保证以收盘价成交(回测通用简化)
 *   - 费率 feeRate 语义是「百分数的数值部分」，如 0.03 表示 0.03%(万分之三)
 *   - dailyValues.marketValue 字段使用的是补仓前的旧市值，与最终持仓市值可能不一致
 * ==========================================================================================
 */
const logger = require('../utils/logger');
const spider = require('./spider');
const { calcAnnualReturn, calcMaxDrawdown, calcSharpeRatio, calcVolatility } = require('../utils/helpers');

// 导入全新 MVC 模型层实体
const Stock = require('../models/Stock');
const HistoryData = require('../models/HistoryData');
const TradeRecord = require('../models/TradeRecord');
const BacktestResult = require('../models/BacktestResult');

/**
 * 执行单次组合回测（系统最核心函数）
 *
 * @param {Object} params - 回测参数对象
 * @param {string} params.startDate - 回测起始日期 'YYYY-MM-DD'
 * @param {string} params.endDate - 回测结束日期 'YYYY-MM-DD'
 * @param {number} [params.initialCapital=1000000] - 初始资金(元)，默认100万
 * @param {number} [params.feeRate=0.03] - ⚠️ 单边交易费率，语义为「百分数的数值部分」
 *        即 0.03 表示 0.03%(万分之三)。calcFee 内部会再除以 100。
 * @param {boolean} [params.feeExemptFive=true] - 是否「免五」(单笔不足5元是否按5元收取)
 * @param {Array<{code,name}>} [params.etfs=[]] - 参与回测的 ETF 列表
 * @param {Object} [params.initialRatios={}] - 初始目标占比 {code: 百分数}
 * @param {Object} [params.strategyAConfig=null] - 策略A配置(回撤分档)，null表示不启用
 * @param {Object} [params.strategyBConfig=null] - 策略B配置(年化中枢偏离)，null表示不启用
 * @param {Object} [params.rebalanceConfig=null] - 再平衡开关，null表示不启用
 * @param {number} [params.rebalanceThreshold=1.5] - 再平衡触发阈值(占比偏离百分比)
 * @param {string} [params.tradeFrequency='monthly'] - 调仓频率 'daily'|'weekly'|'monthly'
 * @param {string} [params.strategyPriority='rebalance'] - 策略冲突时的优先级
 *        'rebalance'|'strategy_a'|'strategy_b'
 * @param {number} [params.centralAnnual=10] - 策略B的年化中枢目标值(%)
 * @param {boolean} [params.resetOnHigh=true] - 创新高是否自动复位档位
 * @param {boolean} [params.isOptimization=false] - 是否为寻优模式(寻优模式跳过流水落盘)
 * @returns {Promise<Object>} 回测结果，含 totalReturn/annualReturn/maxDrawdown 等全套指标
 */
async function runBacktest(params) {
    let {
        startDate,
        endDate,
        initialCapital = 1000000,
        feeRate = 0.03, // ⚠️ 前端传的是百分比数值，如 0.03 表示 0.03%，calcFee 会再 /100
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
        resetOnHigh = true
    } = params;

    // ===== 阶段 0：静默自清洗 —— 剥离被禁用(is_enabled=0) the ETF =====
    // 极其关键的防御性逻辑：即使用户前端传入了某个已禁用的 ETF，回测引擎也会从 etfs 列表和
    // initialRatios 中物理移除它，确保禁用资产绝不参与回测。
    try {
        const disabledEtfs = await Stock.findAll("is_enabled = 0");
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

    // ===== 阶段 0.1：加载每个 ETF 的「专属加减比步长」step_ratio =====
    // 步长是「倍数模型」的核心参数：策略档位的 targetRatio(倍数) 乘以 step_ratio 才是实际增减的占比。
    // 例如某 ETF 初始占比30%，档位倍数=1，step_ratio=5，则该档实际占比 = 30 + 1×5 = 35%。
    // 每个 ETF 可以有独立的步长(默认5%)，从而支持差异化加仓力度。
    const stepRatios = {};
    try {
        const allEtfs = await Stock.findAll();
        (allEtfs || []).forEach(e => {
            stepRatios[e.code] = parseFloat(e.step_ratio !== null && e.step_ratio !== undefined ? e.step_ratio : 5.0);
        });
    } catch (err) {
        logger.error(`[回测引擎] 加载专属步长失败: ${err.message}`);
    }

    // 保持原始费率数值，统一交给 calcFee 处理(内部会除以100)
    const tradeFeeRate = feeRate;

    logger.info(`开始回测: ${startDate} ~ ${endDate}, 初始资金: ${initialCapital}, 频率: ${tradeFrequency}`);
    logger.info(`策略A传入参数配置: ${JSON.stringify(strategyAConfig)}`);

    // ===== 阶段 1：确定收益对比基准 =====
    // 允许用户自定义对比基准。从数据库中查找 Marked 为 is_benchmark = 1 的标的。
    // 去掉兜底默认。若无任何标的被勾选为基准，则 benchmarkCode 为 null，本次回测无对比基准。
    let benchmarkCode = null;
    let benchmarkStock = null;
    try {
        benchmarkStock = await Stock.findOne({ is_benchmark: 1 });
        if (benchmarkStock) {
            benchmarkCode = benchmarkStock.code;
            logger.info(`[回测引擎] 成功从数据库加载自定义对比基准: ${benchmarkStock.name} (${benchmarkCode})`);
        } else {
            logger.info(`[回测引擎] 数据库未设置对比基准，本次回测不启用对比基准`);
        }
    } catch (err) {
        logger.error(`[回测引擎] 获取基准标的失败: ${err.message}`);
    }

    // ===== 阶段 2：从本地数据库读取所有 ETF 的历史数据 =====
    // 优先使用本地 history_data 表(速度快、数据可控)；本地无数据时回退到爬虫实时抓取。
    // 字段映射：DB 的 trade_date(Date) → tradeDate(string)、close_price → closePrice 等。
    const historyDataMap = {};
    for (const etf of etfs) {
        try {
            const dbRows = await HistoryData.getHistoryByRange(etf.code, startDate, endDate);
            const scaleFactor = etf.scale_factor ? parseInt(etf.scale_factor) : 1;
            
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
                        closePrice: parseFloat(d.close_price) / scaleFactor,
                        openPrice: parseFloat(d.open_price || 0) / scaleFactor
                    };
                });
                logger.info(`从本地加载 ${etf.code} 历史数据: ${dbRows.length} 条，最早: ${historyDataMap[etf.code][0].tradeDate}，应用缩小倍率: ${scaleFactor}`);
            } else {
                // 本地无数据，回退到爬虫接口(可能有数据范围限制和限流)
                logger.warn(`本地无 ${etf.code} 数据，回退到爬虫接口`);
                const rawData = await spider.fetchETFHistoryData(etf.code, startDate, endDate);
                historyDataMap[etf.code] = rawData.map(d => ({
                    ...d,
                    tradeDate: String(d.tradeDate).slice(0, 10),
                    closePrice: parseFloat(d.closePrice) / scaleFactor,
                    openPrice: parseFloat(d.openPrice || 0) / scaleFactor
                }));
            }
        } catch (e) {
            logger.error(`加载 ${etf.code} 数据失败: ${e.message}`);
            historyDataMap[etf.code] = [];
        }
    }

    // ===== 阶段 3：读取对比基准历史数据 =====
    // 基准数据用于计算基准指标(与组合对比)，仅在 benchmarkCode 有效时拉取，缺失则回退爬虫。
    let benchmarkHistory = [];
    if (benchmarkCode) {
        try {
            const dbRows = await HistoryData.getHistoryByRange(benchmarkCode, startDate, endDate);
            if (dbRows && dbRows.length > 0) {
                benchmarkHistory = dbRows.map(r => {
                    let tradeDate;
                    if (r.trade_date instanceof Date) {
                        const d = r.trade_date;
                        tradeDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    } else {
                        tradeDate = String(r.trade_date).slice(0, 10);
                    }
                    return { tradeDate, closePrice: parseFloat(r.close_price) };
                });
                logger.info(`从本地加载 ${benchmarkCode} 基准数据: ${benchmarkHistory.length} 条，最早: ${benchmarkHistory[0].tradeDate}`);
            } else {
                logger.warn(`本地无 ${benchmarkCode} 基准数据，回退到接口`);
                try {
                    benchmarkHistory = await spider.fetchETFHistoryDataEastMoney(benchmarkCode, startDate, endDate);
                } catch (emErr) {
                    logger.warn(`[回测引擎] 抓取东财基准数据失败: ${emErr.message}，回退到腾讯`);
                }
                if (!benchmarkHistory || benchmarkHistory.length === 0) {
                    benchmarkHistory = await spider.fetchETFHistoryData(benchmarkCode, startDate, endDate);
                }
                
                // 写入本地数据库做持久化缓存，加速下次运行
                if (benchmarkHistory && benchmarkHistory.length > 0) {
                    for (const row of benchmarkHistory) {
                        const existing = await HistoryData.findOne({
                            etf_code: benchmarkCode,
                            trade_date: row.tradeDate
                        });
                        if (!existing) {
                            await HistoryData.create({
                                etf_code: benchmarkCode,
                                trade_date: row.tradeDate,
                                open_price: row.openPrice || row.closePrice,
                                close_price: row.closePrice,
                                high_price: row.highPrice || row.closePrice,
                                low_price: row.lowPrice || row.closePrice,
                                volume: row.volume || 0,
                                change_pct: 0
                            });
                        }
                    }
                    logger.info(`已将爬取的 ${benchmarkHistory.length} 条 ${benchmarkCode} 基准历史成功保存入库缓存`);
                }
            }
        } catch (e) {
            logger.error('读取基准数据失败: ' + e.message);
            try {
                try {
                    benchmarkHistory = await spider.fetchETFHistoryDataEastMoney(benchmarkCode, startDate, endDate);
                } catch (emErr) {
                    logger.warn(`[回测引擎] 抓取东财基准数据失败: ${emErr.message}，回退到腾讯`);
                }
                if (!benchmarkHistory || benchmarkHistory.length === 0) {
                    benchmarkHistory = await spider.fetchETFHistoryData(benchmarkCode, startDate, endDate);
                }
            } catch (爬网err) {
                logger.error('网络抓取基准数据失败: ' + 爬网err.message);
            }
        }
    }

    // ===== 阶段 4：生成全局日期轴 =====
    // 将基准和所有ETF的交易日期合并去重并排序，形成统一的回测时间轴。
    // 这样即使某天某ETF停牌，主循环依然会前进，用价格记忆填充停牌价。
    const allDates = new Set();
    benchmarkHistory.forEach(h => allDates.add(h.tradeDate));
    Object.values(historyDataMap).forEach(data => {
        data.forEach(d => allDates.add(d.tradeDate));
    });

    // 兜底：如果没有任何数据日期，补上开始和结束日期
    if (allDates.size === 0) {
        allDates.add(startDate);
        allDates.add(endDate);
    }

    const sortedDates = Array.from(allDates).sort();

    if (sortedDates.length === 0) {
        return { error: '未获取到任何历史数据，请先同步行情数据' };
    }

    // ===== 初始化核心运行时状态变量 =====
    let cash = initialCapital;                       // 当前现金
    let portfolio = {};                              // 持仓字典 {code: {shares, costPrice, ratio}}
    let totalValue = initialCapital;                 // 当前组合总市值(现金+持仓)
    let dailyValues = [];                            // 每日净值序列(用于绘图和指标)
    let dailyReturns = [];                           // 每日收益率序列(用于计算波动率)
    let tradeRecords = [];                           // 交易流水记录
    let historyHighValue = initialCapital;           // 历史净值最高点(用于回撤计算和创新高复位)
    let currentALevel = 0;                           // 策略A当前所在档位(0=初始)
    let currentBLevel = 0;                           // 策略B当前所在档位(0=初始，负数=低估档)

    // 持久化当前激活的目标比例：策略触发后会从 initialRatios 漂移，复位时再回到 initialRatios
    let activeTargetRatios = { ...initialRatios };

    // 价格记忆：记录每个 ETF 的最后有效价格，停牌/未上市时沿用，绝不归零(防止回测失真)
    let lastValidPrices = {};
    // 基准价格记忆 & 基准首价(用于将基准折算成同等初始资金的可比净值)
    let lastBenchmarkPrice = benchmarkHistory.length > 0 ? benchmarkHistory[0].closePrice : 0;
    const benchmarkBasePrice = lastBenchmarkPrice;

    // ==========================================================
    // 阶段 5：初始化持仓结构
    // ==========================================================
    // 为每个参与回测的 ETF 建立基础持仓状态，默认份额为0、成本为0。
    for (const etf of etfs) {
        portfolio[etf.code] = { shares: 0, costPrice: 0, ratio: 0, isListed: false };
    }

    // ==========================================================
    // 阶段 6：初始建仓（仅针对回测首日已上市的标的）
    // ==========================================================
    // ⚠️ [已知简化] 使用首日收盘价建仓。真实交易无法保证以收盘价成交。
    //   若需更真实，可改用次日开盘价(openPrice)。此处 openPrice 已加载但未用于交易。
    //
    // 【防未来数据穿越】：只有首日已上市(有有效收盘价)的标的才建仓；
    //   未上市标的留存现金，待其上市首日在主循环中自动延迟建仓。
    const firstTradeDate = sortedDates[0];
    for (const etf of etfs) {
        const ratio = initialRatios[etf.code] || 0;
        if (ratio <= 0) continue; // 比例为0的标的不予配资

        const data = historyDataMap[etf.code] || [];
        // 查找该 ETF 在回测首日当天的行情数据
        const firstDayData = data.find(d => d.tradeDate === firstTradeDate);

        // 如果在回测首日能获取到有效收盘价，说明该资产已上市，立即执行首日初始建仓
        if (firstDayData && firstDayData.closePrice > 0) {
            const price = firstDayData.closePrice;                  // ⚠️ 使用收盘价建仓(已知简化)
            const targetValue = initialCapital * (ratio / 100);     // 目标资产配置金额
            const shares = Math.floor(targetValue / price / 100) * 100; // 按100股(1手)向下取整，避免超支
            const amount = shares * price;
            const fee = calcFee(amount, tradeFeeRate, feeExemptFive); // 交易费用(含最低5元限制)

            portfolio[etf.code] = { shares, costPrice: price, ratio, isListed: true };
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
            // 若首日未上市，不做任何扣款，初始化份额为0。
            // 后续该标的在主循环中上市时(3.2 延迟补仓)，会自动按当时的总市值比例建仓。
            logger.warn(`[初始建仓] 标的 ${etf.code} 在首日 ${firstTradeDate} 尚未上市或无有效价格，将延迟至其上市首日自动补仓`);
            portfolio[etf.code] = { shares: 0, costPrice: 0, ratio: 0, isListed: false };
        }
    }

    // ==========================================================
    // 阶段 7：回测时间轴主循环（逐日流动计算）
    // ==========================================================
    for (let i = 0; i < sortedDates.length; i++) {
        const date = sortedDates[i];
        let datePrices = {};
        let didStrategyTrade = false; // 标记当天是否执行了策略 A/B 调仓交易

        // ---------- 7.1 更新当日所有标的价格 + 维护价格记忆 ----------
        // 停牌/未上市当天若无行情，沿用历史最新的有效价格(绝不归零)，保证组合市值连续性。
        for (const etf of etfs) {
            const data = historyDataMap[etf.code] || [];
            const dayData = data.find(d => d.tradeDate === date);

            if (dayData && dayData.closePrice > 0) {
                datePrices[etf.code] = dayData.closePrice;
                lastValidPrices[etf.code] = dayData.closePrice; // 更新最新有效价格记忆
            } else {
                // 当日停牌、非交易日或未上市，价格沿用历史最新的有效价格记忆
                datePrices[etf.code] = lastValidPrices[etf.code] || 0;
            }
        }

        // ---------- 7.2 延迟补仓(针对上市首日的标的) + 计算当日持仓总市值 ----------
        // 自动补仓逻辑：若某标的前期未上市且未被标记为上市(shares===0 && !isListed)，今天有了有效价格(price>0)，
        // 则按其初始占比对"当前总市值"建仓(注意：用 totalValue 而非 initialCapital)。
        let totalMarketValue = 0;
        for (const etf of etfs) {
            const holding = portfolio[etf.code];
            const price = datePrices[etf.code] || 0;

            // 自动补仓：未上市标的在今天首次出现有效价格，触发延迟建仓，设置 isListed 规避后续误触发
            if (holding && holding.shares === 0 && !holding.isListed && price > 0) {
                holding.isListed = true; // 只要上市首日有了有效价格，立刻标记为已上市
                const ratio = initialRatios[etf.code] || 0;
                if (ratio > 0) {
                    const targetValue = totalValue * (ratio / 100);
                    const shares = Math.floor(targetValue / price / 100) * 100;
                    if (shares > 0) {
                        const amount = shares * price;
                        const fee = calcFee(amount, tradeFeeRate, feeExemptFive);
                        if (cash >= amount + fee) { // 必须现金充足才执行补仓
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

        // ⚠️ [注意] 此处 totalMarketValue 是「延迟补仓后、策略调仓前」的市值快照。
        // 当日组合总市值 = 现金 + 持仓总市值
        totalValue = cash + totalMarketValue;

        // ---------- 7.3 更新历史净值最高点 ----------
        if (totalValue > historyHighValue) {
            historyHighValue = totalValue;
        }

        // ---------- 7.4 计算当前回撤幅度(%) ----------
        // 回撤 = (历史最高净值 - 当前净值) / 历史最高净值 × 100
        const drawdown = historyHighValue > 0 ? (historyHighValue - totalValue) / historyHighValue * 100 : 0;

        // ---------- 7.5 判断今天是否为调仓评估日 ----------
        // 根据用户设置的频率决定当日是否进行策略研判和调仓：
        //   - daily  : 每个交易日都评估
        //   - weekly : 周五评估(或最后一天)
        //   - monthly: 跨月前一天评估(即明天是下个月，或最后一天)
        let isTradeDay = false;
        if (tradeFrequency === 'daily') {
            isTradeDay = true;
        } else if (tradeFrequency === 'weekly') {
            const d = new Date(date);
            if (d.getDay() === 5 || i === sortedDates.length - 1) isTradeDay = true; // 周五或最后一天
        } else if (tradeFrequency === 'monthly') {
            const d = new Date(date);
            const nextDate = sortedDates[i + 1];
            if (!nextDate || new Date(nextDate).getMonth() !== d.getMonth()) isTradeDay = true; // 跨月或最后一天
        }

        // ---------- 7.6 策略与调仓研判(仅在调仓评估日执行) ----------
        if (isTradeDay) {
            let aResult = null;  // 策略A研判结果
            let bResult = null;  // 策略B研判结果

            // ----------------------------------------
            // 7.6.1 策略 A 研判（净值回撤/反弹档位策略）
            // ----------------------------------------
            // 策略A根据组合净值相对历史最高点的回撤幅度，动态调整各标的的目标占比(加仓/减仓)。
            // 回撤越深，触发更高档位的加仓倍数；反弹则逐级退档减仓；创新高则全部复位。
            if (strategyAConfig) {
                const configWithOverride = { ...strategyAConfig, resetOnHigh };

                // 【创新高主动复位】(最高优先级)：净值创历史新高时，把档位和目标比例全部重置为初始配置。
                // 这是策略A档位复位的唯一入口（evaluateStrategyA 内部已移除冗余的兜底复位判断）。
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
                    // 未创新高，交由 evaluateStrategyA 根据回撤幅度研判档位
                    aResult = evaluateStrategyA(
                        configWithOverride, drawdown, historyHighValue,
                        totalValue, currentALevel, initialRatios, stepRatios
                    );
                }
            }

            // ----------------------------------------
            // 7.6.2 策略 B 研判（长期年化中枢偏离估值策略）
            // ----------------------------------------
            // 策略B根据组合「当前年化收益率」相对「中枢目标年化」的偏离度，动态调整仓位。
            // 年化远超中枢(高估)→减仓；年化远低于中枢(低估)→加仓。
            if (strategyBConfig) {
                // 计算当前持有的实际年数(从回测起点到现在)，用于年化收益率计算
                const yearsCount = (new Date(date) - new Date(startDate)) / (365 * 24 * 60 * 60 * 1000);

                // 增加稳定期保护：前 6 个月（0.5年）不运行策略 B，避免早期年化率放大误差导致误触发
                if (yearsCount < 0.5) {
                    bResult = null;
                } else {
                    const totalReturn = (totalValue - initialCapital) / initialCapital * 100;
                    const currentAnnualReturn = calcAnnualReturn(totalReturn, Math.max(yearsCount, 0.1));

                    const configWithOverride = { ...strategyBConfig, centralAnnual };
                    // 偏离度 = 当前年化 - 中枢年化；正值=高估，负值=低估
                    const deviation = currentAnnualReturn - configWithOverride.centralAnnual;

                    bResult = evaluateStrategyB(configWithOverride, deviation, currentBLevel, initialRatios, stepRatios);
                }
            }

            // ----------------------------------------
            // 7.6.3 决策融合引擎（先合并研判决策，后一次性交易）
            // ----------------------------------------
            // 核心重构点：解决「多策略同日触发导致资产擦除和多重扣费」的历史漏洞。
            // 思路：先把策略A、策略B、再平衡三者的信号汇总，按优先级裁决出唯一执行结果，
            //       然后调用一次 executeTrades 一次性完成调仓，避免重复交易。
            let chosenResult = null;
            let chosenStrategy = '';

            // 【再平衡优先前置研判】：先扫描是否有标的的占比偏离达到阈值
            let isRebalanceTriggered = false;
            if (rebalanceConfig && rebalanceThreshold > 0) {
                for (const etf of etfs) {
                    const price = datePrices[etf.code] || 0;
                    if (price <= 0) continue;

                    const currentRatio = (portfolio[etf.code].shares * price) / totalValue * 100;
                    const targetRatio = activeTargetRatios[etf.code] || 0;
                    const dev = Math.abs(currentRatio - targetRatio);

                    if (dev >= rebalanceThreshold) {
                        isRebalanceTriggered = true;
                        break;
                    }
                }
            }

            // 【再平衡优先裁决】：当用户设置 strategyPriority='rebalance' 且同时有策略A/B信号时，
            //   压制策略信号(避免在剧烈波动的底部割肉)，让日常再平衡稍后单独处理。
            //   这是「再平衡优先」模式的核心保护逻辑。
            if (isRebalanceTriggered && strategyPriority === 'rebalance' && (aResult || bResult)) {
                logger.info(`[再平衡优先裁决] 日期 ${date}: 触发再平衡偏离，压制策略 A/B 信号`);
                chosenResult = null;
            } else {
                // 按用户设置的策略优先级，从 A/B 中选出唯一执行结果
                if (aResult && bResult) {
                    // A/B 同日同时触发，采用用户预设的优先级
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

            // 执行被选中的策略调仓(一次性对齐到新的目标比例)
            if (chosenResult) {
                if (chosenStrategy === 'strategy_a') {
                    // 复位时用 initialRatios，否则用研判结果的目标比例
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
                        didStrategyTrade = true; // 标记当天已执行策略交易

                        // 创新高复位后，把历史高点也更新为当前值(避免重复触发)
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
                        didStrategyTrade = true; // 标记当天已执行策略交易
                    }
                }
            }

            // ----------------------------------------
            // 7.6.4 日常再平衡研判模块（独立于策略A/B的第二道调仓机制）
            // ----------------------------------------
            // 【触发条件】：任意单个标的的「实际占比」偏离「当前生效的目标占比(activeTargetRatios)」
            //   达到 rebalanceThreshold 即触发，一键把所有标的对齐回 activeTargetRatios。
            // 注意：这里对齐的是 activeTargetRatios(策略漂移后的目标)，而非 initialRatios。
            //   如果漂移回初始比例，则顺便复位策略档位级别。
            // 额外修复：若当天已经执行了策略 A/B 的调仓交易，则直接跳过再平衡，避免同一天二次调仓及重复扣手续费
            if (!didStrategyTrade && rebalanceConfig && rebalanceThreshold > 0) {
                let needRebalanceTrigger = false;
                let maxDeviationInfo = '';

                for (const etf of etfs) {
                    const price = datePrices[etf.code] || 0;
                    if (price <= 0) continue; // 未上市或停牌的标的不参与偏离研判

                    const currentRatio = (portfolio[etf.code].shares * price) / totalValue * 100;
                    const targetRatio = activeTargetRatios[etf.code] || 0;
                    const dev = Math.abs(currentRatio - targetRatio);

                    // 只要发现任意一个标的偏离度达到阈值，就触发调仓
                    if (dev >= rebalanceThreshold) {
                        needRebalanceTrigger = true;
                        maxDeviationInfo = `标的 ${etf.code} 实际占比 ${currentRatio.toFixed(2)}% 偏离目标 ${targetRatio.toFixed(2)}% (超差 ${dev.toFixed(2)}%)`;
                        break;
                    }
                }

                // 触发日常再平衡：一键对齐到当前生效的目标配置比例
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

                        // 如果再平衡后的目标比例恰好回到了初始基础比例，
                        // 则自动重置策略A/B的档位级别，开启新一轮研判循环。
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

        // ---------- 7.7 重新计算当日总市值(调仓后) ----------
        // 调仓完成后，持仓份额发生变化，重新累加得到准确的当日总市值。
        let mv = 0;
        for (const etf of etfs) {
            mv += (portfolio[etf.code]?.shares || 0) * (datePrices[etf.code] || 0);
        }
        totalValue = cash + mv;

        // [已修复] 原代码 dailyValues.marketValue 使用的是阶段 7.2 计算的
        //   totalMarketValue（延迟补仓后、策略调仓前的快照），与最终持仓市值不一致，
        //   导致前端"资产配置变动图"和"市值展示"出现偏差。
        //   修复原因：策略调仓（executeTrades）会改变持仓份额，totalMarketValue
        //   不再代表当日真实的持仓市值；应使用此处调仓后重新累加的 mv。
        //   修复方式：把 marketValue 赋值为 mv（调仓后的最新市值）。
        totalMarketValue = mv;

        // ---------- 7.8 计算对比基准净值 ----------
        // 精确匹配当日基准价，找不到则沿用价格记忆(不回退到0)。
        // 将基准折算成「同等初始资金」的可比净值：initialCapital × (当日基准价 / 基准首价)
        let benchmarkValue = null;
        if (benchmarkCode && benchmarkBasePrice > 0) {
            const benchmarkDay = benchmarkHistory.find(h => h.tradeDate === date);
            if (benchmarkDay && benchmarkDay.closePrice > 0) {
                lastBenchmarkPrice = benchmarkDay.closePrice;
            }
            benchmarkValue = parseFloat((initialCapital * (lastBenchmarkPrice / benchmarkBasePrice)).toFixed(2));
        }

        // ---------- 7.9 记录当日资产占比详情(用于前端面积图) ----------
        const assetRatios = { cash: (cash / totalValue * 100) };
        for (const etf of etfs) {
            const holding = portfolio[etf.code];
            const price = datePrices[etf.code] || 0;
            assetRatios[etf.code] = totalValue > 0 ? (holding.shares * price / totalValue * 100) : 0;
        }

        // [已修复] marketValue 现在使用的是阶段 7.7 重新累加的 totalMarketValue，
        //   即调仓后的最新持仓市值（见上方 totalMarketValue = mv 赋值）。
        dailyValues.push({
            date,
            totalValue,
            cash,
            marketValue: totalMarketValue, // 调仓后的最新市值
            benchmarkValue,
            drawdown: -drawdown,           // 负号表示回撤(向下为负)
            assetRatios
        });

        // ---------- 7.10 计算当日收益率(用于波动率) ----------
        // 日收益率 = (当日总市值 - 前日总市值) / 前日总市值 × 100
        if (i > 0) {
            const prevValue = dailyValues[i - 1]?.totalValue || initialCapital;
            const dailyReturn = (totalValue - prevValue) / prevValue * 100;
            dailyReturns.push(dailyReturn);
        }
    }

    // ===== 阶段 8：计算策略组合 + 沪深300 + 每只ETF 的全套量化指标 =====

    // 8.1 策略组合核心指标
    const finalTotalValue = dailyValues[dailyValues.length - 1]?.totalValue || initialCapital;
    const totalReturn = (finalTotalValue - initialCapital) / initialCapital * 100;
    const years = (new Date(endDate) - new Date(startDate)) / (365 * 24 * 60 * 60 * 1000);
    const annualReturn = calcAnnualReturn(totalReturn, years);                    // 几何年化收益率
    const maxDrawdown = calcMaxDrawdown(dailyValues.map(d => d.totalValue));      // 最大回撤
    const annualVolatility = calcVolatility(dailyReturns);                       // 年化波动率
    const sharpeRatio = calcSharpeRatio(annualReturn, 2.5, annualVolatility);    // 夏普比率(无风险利率2.5%)

    // 8.2 对比基准全套指标(仅在 benchmarkCode 存在时计算)
    let benchmarkMetrics = null;
    if (benchmarkCode) {
        const benchmarkValues = dailyValues.map(d => d.benchmarkValue).filter(v => v !== null && v !== undefined);
        const benchmarkDailyReturns = [];
        for (let i = 1; i < benchmarkValues.length; i++) {
            const r = (benchmarkValues[i] - benchmarkValues[i - 1]) / benchmarkValues[i - 1] * 100;
            benchmarkDailyReturns.push(r);
        }
        const benchmarkTotalReturn = benchmarkValues.length > 0 ? (benchmarkValues[benchmarkValues.length - 1] - initialCapital) / initialCapital * 100 : 0;
        const benchmarkAnnualReturn = calcAnnualReturn(benchmarkTotalReturn, years);
        const benchmarkMaxDrawdown = calcMaxDrawdown(benchmarkValues);
        const benchmarkVolatility = calcVolatility(benchmarkDailyReturns);
        const benchmarkSharpeRatio = calcSharpeRatio(benchmarkAnnualReturn, 2.5, benchmarkVolatility);

        benchmarkMetrics = {
            name: benchmarkStock ? benchmarkStock.name : '对比基准',
            totalReturn: parseFloat(benchmarkTotalReturn.toFixed(4)),
            annualReturn: parseFloat(benchmarkAnnualReturn.toFixed(4)),
            maxDrawdown: parseFloat(benchmarkMaxDrawdown.toFixed(4)),
            annualVolatility: parseFloat(benchmarkVolatility.toFixed(4)),
            sharpeRatio: parseFloat(benchmarkSharpeRatio.toFixed(4)),
        };
    }

    // 8.3 为每个 ETF 建立标准化日期的价格查找表，并记录其上市首价
    // 用于把每只ETF的走势也折算成「同等初始资金」的独立净值曲线，计算其独立指标。
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
                if (firstPrice === 0) firstPrice = h.closePrice; // 记录第一个有效价格作为基准
            }
        });

        etfPriceMaps[etf.code] = priceMap;
        etfFirstPrices[etf.code] = firstPrice;
    });

    // 8.4 计算每只ETF的独立量化指标(用于前端对比表)
    const etfMetrics = {};
    for (const etf of etfs) {
        const priceMap = etfPriceMaps[etf.code];
        // 把ETF价格序列折算成与组合同等初始资金的净值序列
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

    // 8.6 历年盈亏分布统计
    // 按自然年统计每年的策略收益率和对比基准收益率，用于前端历年盈亏柱状图
    const yearGroups = {};
    dailyValues.forEach(d => {
        const year = d.date.slice(0, 4);
        if (!yearGroups[year]) {
            // 记录每年的第一个和最后一个净值
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

    const yearlyStats = Object.keys(yearGroups).sort().map(year => {
        const g = yearGroups[year];
        return {
            year,
            strategyReturn: parseFloat(((g.lastStrategy - g.firstStrategy) / g.firstStrategy * 100).toFixed(2)),
            benchmarkReturn: benchmarkCode && g.firstBenchmark !== null && g.lastBenchmark !== null ? parseFloat(((g.lastBenchmark - g.firstBenchmark) / g.firstBenchmark * 100).toFixed(2)) : null
        };
    });

    // etfCurrentLastPrices: 记录每个ETF的最后已知价格，用于在 dailyValues 渲染时填充停牌日的净值
    const etfCurrentLastPrices = {};

    // 8.5 组装最终回测结果对象
    const result = {
        params,
        totalReturn: parseFloat(totalReturn.toFixed(4)),
        annualReturn: parseFloat(annualReturn.toFixed(4)),
        maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
        annualVolatility: parseFloat(annualVolatility.toFixed(4)),
        sharpeRatio: parseFloat(sharpeRatio.toFixed(4)),
        finalValue: parseFloat(finalTotalValue.toFixed(2)),
        totalTrades: tradeRecords.length,
        yearlyStats, // 历年盈亏分布
        benchmarkMetrics: benchmarkMetrics,
        etfMetrics, // 每只ETF的独立指标
        tradeRecords: tradeRecords.slice(0, 2000), // 限制返回的流水条数，避免响应过大
        dailyValues: dailyValues.map(d => {
            // 为每日数据附加每个ETF的独立净值表现(用于前端叠加对比曲线)
            const etfPerformances = {};
            const currentDateStr = d.date.slice(0, 10);

            for (const etf of etfs) {

                const priceMap = etfPriceMaps[etf.code];
                const dayPrice = priceMap.get(currentDateStr);

                // 更新该ETF的最后已知价格(停牌日沿用)
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
                benchmarkValue: d.benchmarkValue !== null && d.benchmarkValue !== undefined ? parseFloat(Number(d.benchmarkValue).toFixed(2)) : null,
                drawdown: parseFloat(Number(d.drawdown).toFixed(4)),
                etfPerformances
            };
        })
    };

    // ===== 阶段 9：结果持久化 =====
    // 寻优模式(isOptimization=true)：只保存排行榜级别的精简数据，跳过 daily_detail 大字段和流水，
    //   避免大量寻优组合撑爆数据库。
    // 单次精细回测：保存完整 result(含 daily_detail) 和交易流水(限500条，去重)。
    try {
        const isOptimization = params.isOptimization === true;

        // 调用 BacktestResult 模型一键保存回测结果
        await BacktestResult.saveResult(
            isOptimization ? `寻优_${startDate}_${endDate}` : `回测_${startDate}_${endDate}`,
            params,
            result.totalReturn,
            result.annualReturn,
            result.maxDrawdown,
            result.annualVolatility,
            result.sharpeRatio,
            isOptimization ? null : result // 寻优时传 null 不写 daily_detail，单次回测传完整 result
        );

        // 仅在单次精细回测时才写入交易流水(寻优遍历时跳过，避免写入几十万条垃圾流水)
        if (!isOptimization) {
            for (const t of tradeRecords.slice(0, 500)) {
                // 去重检查：同一时间、同一标的、同一方向的交易不重复写入
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

/**
 * 参数网格寻优(笛卡尔积遍历)
 *
 * 对 optimizationRanges 中每个参数的取值列表做笛卡尔积，组合出所有可能的参数搭配，
 * 对每种组合分别执行一次 runBacktest(寻优模式)，最后按「年化收益降序 + 最大回撤升序」排序。
 *
 * 【防爆盘机制】：寻优时强制 isOptimization=true，跳过 daily_detail 和流水落盘，
 *   否则几百次回测会产生海量数据撑爆数据库。
 *
 * @param {Object} params
 * @param {Object} params.baseParams - 基础回测参数(所有组合共享)
 * @param {Object} params.optimizationRanges - 待遍历的参数维度，如 {rebalanceThreshold:[1,2,3]}
 * @returns {Promise<Object>} { totalCombinations, sortedResults(前50), bestParams }
 */
async function runParameterOptimization(params) {
    const { baseParams, optimizationRanges } = params;
    const results = [];
    let totalCombinations = 1;

    const rangeKeys = Object.keys(optimizationRanges);
    // 计算笛卡尔积总组合数 = 各维度长度的乘积
    for (const key of rangeKeys) {
        totalCombinations *= optimizationRanges[key].length;
    }

    logger.info(`参数寻优开始，共${totalCombinations}种组合`);

    /**
     * 递归遍历每个参数维度的取值，深度优先地展开所有组合
     * @param {Object} currentParams - 当前已确定的参数
     * @param {number} depth - 当前处理的参数维度索引
     */
    async function iterateRanges(currentParams, depth) {
        if (depth >= rangeKeys.length) {
            // 所有维度都已取值，执行一次回测(强制寻优模式避免爆盘)
            const result = await runBacktest({ ...baseParams, ...currentParams, isOptimization: true });
            results.push({ params: { ...currentParams }, ...result });
            return;
        }

        const key = rangeKeys[depth];
        for (const value of optimizationRanges[key]) {
            currentParams[key] = value;
            await iterateRanges({ ...currentParams }, depth + 1);

            // 每10个组合打印一次进度
            if (results.length % 10 === 0) {
                logger.info(`参数寻优进度: ${results.length}/${totalCombinations}`);
            }
        }
    }

    await iterateRanges({}, 0);

    // 排序：年化收益降序优先，回撤升序次之(收益相同时选回撤小的)
    results.sort((a, b) => b.annualReturn - a.annualReturn || a.maxDrawdown - b.maxDrawdown);

    logger.info(`参数寻优完成，共${results.length}种组合`);
    return {
        totalCombinations: results.length,
        sortedResults: results.slice(0, 50), // 只返回前50名
        bestParams: results[0] || null
    };
}

/**
 * 策略A研判：根据组合净值的回撤幅度，计算应进入的档位和对应的目标比例
 *
 * 【算法原理】
 *   1. 创新高复位(最高优先级)：净值达到历史最高点 → 档位归零，比例回到 initialRatios
 *   2. 回撤加深加仓：回撤达到某档阈值 → 进入该档，按倍数模型增加目标占比
 *   3. 反弹跨级退档：回撤收窄至更浅一档阈值以内 → 退到更浅一档
 *   4. 震荡/反弹不足：坚守当前档位，不调仓
 *
 * 【倍数模型】ratios 中每个 targetRatio 是「倍数」：
 *   实际目标占比 = initialRatios[code] + targetRatio × stepRatios[code]
 *   (例如 初始30% + 倍数2 × 步长5% = 40%)
 *
 * ⚠️ 【ratios 格式约定】level.ratios 必须是数组 [{etfCode, targetRatio}]，
 *    路由层 config.js 的 formatRatios 会把数据库的 JSON 对象转成此格式。
 *    如果直接传入 JSON 对象，档位配置会静默失效(空数组遍历无效果)。
 *
 * @param {Object} config - 策略A配置 {drawdownLevels, resetOnHigh}
 * @param {number} drawdown - 当前回撤幅度(%)
 * @param {number} historyHigh - 历史最高净值
 * @param {number} currentValue - 当前净值
 * @param {number} currentALevel - 当前所在档位
 * @param {Object} initialRatios - 初始占比
 * @param {Object} stepRatios - 各ETF的加减比步长 {code: 百分数}
 * @returns {Object|null} 研判结果 {action, reason, ratios, newLevel, resetHigh} 或 null(不调仓)
 */
function evaluateStrategyA(config, drawdown, historyHigh, currentValue, currentALevel, initialRatios, stepRatios = {}) {
    // [已修复] 原代码此处有一段「创新高复位」的防御性兜底判断，与主循环第 430 行的
    //   主动复位逻辑重复。这导致两个问题：
    //   1. 职责重叠：主循环已经用 totalValue >= historyHighValue 判断并生成了 reset 结果，
    //      在未创新高时才调用本函数（传入的 currentValue 实际不会 >= historyHigh）。
    //   2. 死代码风险：由于主循环通过 else 分支调用本函数，此处的复位判断永远不会触发，
    //      容易误导维护者以为这是复位主入口。
    //   修复方式：移除冗余的兜底复位判断，让本函数专注于「按回撤幅度研判档位」这一单一职责。
    //   创新高复位的唯一入口收敛到主循环第 430 行。

    // 1. 按回撤幅度寻找当前满足的最高回撤档位
    // 档位按 threshold 从大到小排序，找到第一个 drawdown >= threshold 的档位即为应进入的档位
    const sortedLevels = (config.drawdownLevels || []).sort((a, b) => b.threshold - a.threshold);
    let expectedLevel = 0;
    let expectedRatios = null;

    for (const level of sortedLevels) {
        if (drawdown >= level.threshold) {
            expectedLevel = level.levelOrder;
            // 按倍数模型计算实际目标占比
            const ratios = {};
            (level.ratios || []).forEach(r => {
                const step = stepRatios[r.etfCode] || 5.0; // 缺省步长5%
                ratios[r.etfCode] = (initialRatios[r.etfCode] || 0) + (r.targetRatio * step);
            });
            expectedRatios = ratios;
            break;
        }
    }

    // 3. 档位加深判定(下跌加仓)：目标档位比当前档位更深 → 触发加仓调仓
    if (expectedLevel > currentALevel) {
        return {
            action: 'drawdown',
            reason: `回撤深达 ${drawdown.toFixed(2)}%，触发第 ${expectedLevel} 档加仓配置`,
            ratios: expectedRatios,
            newLevel: expectedLevel,
            resetHigh: false
        };
    }

    // 4. 反弹直接退档判定（直接下调至当前回撤匹配的目标档位，支持跨级与复位，解决逐级退档滞后问题）
    if (expectedLevel < currentALevel) {
        if (expectedLevel === 0) {
            return {
                action: 'rebound',
                reason: `回撤收窄至 ${drawdown.toFixed(2)}%（低于第 1 档阈值），退回初始配置比例`,
                ratios: { ...initialRatios },
                newLevel: 0,
                resetHigh: false
            };
        } else {
            return {
                action: 'rebound',
                reason: `回撤收窄至 ${drawdown.toFixed(2)}%，下调成第 ${expectedLevel} 档配置`,
                ratios: expectedRatios,
                newLevel: expectedLevel,
                resetHigh: false
            };
        }
    }

    return null; // 反弹不够或中间震荡，坚守当前档位不调仓
}

/**
 * 策略B研判：根据组合「当前年化收益率」相对「中枢年化」的偏离度，计算应进入的档位和目标比例
 *
 * 【算法原理】
 *   1. 偏离度 = 当前年化 - 中枢年化；正值=高估(减仓)，负值=低估(加仓)
 *   2. 高估档：偏离 >= 某档阈值 → 减仓(降低权益仓位)
 *   3. 低估档：偏离 <= -某档阈值 → 加仓(增加权益仓位)
 *   4. 回归中枢：偏离在阈值内 → 复位到 initialRatios
 *
 * 【倍数模型】与策略A相同：实际占比 = initialRatio + targetRatio × stepRatio
 *
 * ⚠️ 【ratios 格式约定】level.ratios 必须是数组 [{etfCode, targetRatio}]。
 *
 * @param {Object} config - 策略B配置 {overvaluedLevels, undervaluedLevels}
 * @param {number} deviation - 当前年化与中枢的偏离度(正=高估，负=低估)
 * @param {number} currentLevel - 当前所在档位(正数=高估档，负数=低估档，0=中枢)
 * @param {Object} initialRatios - 初始占比
 * @param {Object} stepRatios - 各ETF的加减比步长
 * @returns {Object|null} 研判结果 {action, reason, ratios, newLevel} 或 null(不调仓)
 */
function evaluateStrategyB(config, deviation, currentLevel, initialRatios, stepRatios = {}) {
    let expectedLevel = 0;
    let expectedRatios = { ...initialRatios };
    let reason = '估值偏离回归正常范围，自动复位至初始配置比例';
    let action = 'reset';

    // 1. 查找当前偏差满足的最高高估档位(从高档到低档遍历)
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

    // 2. 若没有满足的高估档位，查找满足的最高低估档位
    // 注意：低估判断用 -threshold(因为偏离为负)，如 threshold=5 则偏离<=-5才触发
    if (expectedLevel === 0) {
        const sortedUndervalued = (config.undervaluedLevels || []).sort((a, b) => b.levelOrder - a.levelOrder);
        for (const level of sortedUndervalued) {
            if (deviation <= -level.threshold) {
                expectedLevel = -level.levelOrder; // 低估档用负数表示
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

    // 3. 核心逻辑：只有档位级别发生变化时，才触发调仓交易
    // 这样支持高估与低估档位间的动态升降、按偏离幅度自然退档、以及 Level 0 复位，避免状态锁死
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

/**
 * 执行一次性调仓交易(先卖后买，按手数取整)
 *
 * 这是策略调仓和日常再平衡共用的底层交易执行函数。核心原则：
 *   1. 计算每个标的的目标份额与当前份额的差值
 *   2. 先执行所有卖出(释放现金)，后执行所有买入(消耗现金) —— 保证买入时有足够现金
 *   3. 买入按手数(100股)向下取整，卖出按手数向上取整(避免超卖)
 *   4. 现金不足时降级买入(买得起多少买多少)，并在 reason 中标注"(现金受限)"
 *
 * @param {Object} portfolio - 当前持仓 {code: {shares, costPrice, ratio}}
 * @param {Object} prices - 当日各标的价格 {code: price}
 * @param {Object} targetRatios - 目标占比 {code: 百分数}
 * @param {number} totalValue - 当前组合总市值(用于计算目标金额)
 * @param {number} cash - 当前可用现金
 * @param {number} feeRate - ⚠️ 费率(百分数数值部分，如0.03表示0.03%)
 * @param {boolean} feeExemptFive - 是否免五
 * @param {string} reason - 调仓原因(写入流水)
 * @param {string} tradeType - 交易类型 'strategy_a'|'strategy_b'|'rebalance'|'strategy'
 * @returns {Object} {portfolio, cash, marketValue, trades}
 */
function executeTrades(portfolio, prices, targetRatios, totalValue, cash, feeRate, feeExemptFive, reason, tradeType = 'strategy') {
    // 防御：目标比例为空时直接返回当前状态(不调仓)
    if (!targetRatios || Object.keys(targetRatios).length === 0) {
        let mv = 0;
        for (const code of Object.keys(portfolio)) {
            mv += (portfolio[code]?.shares || 0) * (prices[code] || 0);
        }
        return { portfolio, cash, marketValue: mv, trades: [] };
    }

    let remainingCash = cash;
    const trades = [];
    // 深拷贝持仓，避免修改原对象(调仓失败时不影响原状态)
    const newPortfolio = {};
    for (const [code, holding] of Object.entries(portfolio)) {
        newPortfolio[code] = { ...holding };
    }

    // ==========================================
    // 步骤1：计算所有标的的买卖份额需求
    // ==========================================
    const pendingTrades = [];
    for (const [code, targetRatio] of Object.entries(targetRatios)) {
        const holding = newPortfolio[code] || { shares: 0, costPrice: 0, ratio: 0 };
        const price = prices[code] || 0;
        if (price <= 0) continue; // 忽略停牌或未上市标的(无定价)

        const targetValue = totalValue * (targetRatio / 100); // 目标持仓金额
        const currentValue = holding.shares * price;           // 当前持仓金额
        const diffValue = targetValue - currentValue;           // 需要调整的金额(正=买入，负=卖出)

        // 按手数(100股)取整计算份额变化：
        //   买入(diffValue>=0)：向下取整(floor)，防止现金超支
        //   卖出(diffValue<0)：向零取整(ceil)，防止超额超卖
        //   (例如 -1.5手向上取整为-1手，卖出100股而非200股)
        const sharesDelta = diffValue >= 0
            ? Math.floor(diffValue / price / 100) * 100
            : Math.ceil(diffValue / price / 100) * 100;

        if (sharesDelta !== 0) {
            pendingTrades.push({ code, sharesDelta, price });
        }
    }

    // ==========================================
    // 步骤2：先执行所有卖出操作(sharesDelta < 0)
    // ==========================================
    // 先卖后买：卖出会释放现金，确保后续买入有足够资金
    for (const trade of pendingTrades.filter(t => t.sharesDelta < 0)) {
        const holding = newPortfolio[trade.code];
        if (!holding) continue;

        // 实际卖出量不能超过持仓量
        const sellShares = Math.min(Math.abs(trade.sharesDelta), holding.shares);
        if (sellShares > 0) {
            const preAmount = holding.shares * trade.price;  // 卖出前持仓金额
            const preRatio = (preAmount / totalValue) * 100;
            const amount = sellShares * trade.price;
            const fee = calcFee(amount, feeRate, feeExemptFive);

            holding.shares -= sellShares;
            const postAmount = holding.shares * trade.price; // 卖出后持仓金额
            const postRatio = (postAmount / totalValue) * 100;

            remainingCash += (amount - fee); // 卖出回笼现金(扣除费用)
            trades.push({
                type: tradeType, etfCode: trade.code, action: 'sell',
                shares: sellShares, price: trade.price, amount, fee, reason,
                preAmount, postAmount, preRatio, postRatio
            });
        }
    }

    // ==========================================
    // 步骤3：后执行所有买入操作(sharesDelta > 0)
    // ==========================================
    for (const trade of pendingTrades.filter(t => t.sharesDelta > 0)) {
        const holding = newPortfolio[trade.code] || (newPortfolio[trade.code] = { shares: 0, costPrice: 0, ratio: 0 });

        const preAmount = holding.shares * trade.price;
        const preRatio = (preAmount / totalValue) * 100;
        const amount = trade.sharesDelta * trade.price;
        const fee = calcFee(amount, feeRate, feeExemptFive);

        if (remainingCash >= amount + fee) {
            // 现金充足，按目标份额全额买入
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
            // 现金不足，降级买入：按剩余现金(预留0.1%缓冲)能买多少买多少
            const maxShares = Math.floor((remainingCash * 0.999) / trade.price / 100) * 100;
            if (maxShares >= 100) { // 至少买1手才执行
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
                        reason: reason + '(现金受限)', // 标注现金不足降级买入
                        preAmount, postAmount, preRatio, postRatio
                    });
                }
            }
        }
    }

    // 重新计算调仓后的总持仓市值
    let newMarketValue = 0;
    for (const [code, holding] of Object.entries(newPortfolio)) {
        const price = prices[code] || 0;
        newMarketValue += (holding.shares || 0) * price;
    }

    return { portfolio: newPortfolio, cash: remainingCash, marketValue: newMarketValue, trades };
}

/**
 * 判断策略A和策略B的调仓动作是否冲突(预留工具函数，当前主流程未直接调用)
 * @param {Object} aResult - 策略A研判结果
 * @param {Object} bResult - 策略B研判结果
 * @returns {boolean} 是否冲突
 */
function isActionConflicted(aResult, bResult) {
    if (!aResult || !bResult) return false;
    if (aResult.action === 'reset') return true; // 复位动作视为冲突
    return aResult.action !== bResult.action;
}

/**
 * 计算单笔交易费用
 *
 * ⚠️ 【费率语义约定】rate 是「百分数的数值部分」：
 *   - rate=0.03 表示 0.03%(万分之三)
 *   - 内部公式 amount × rate / 100 = amount × 0.0003
 *
 * 【免五规则】中国A股券商的「免五」优惠：单笔佣金不足5元时，
 *   - 免五(exemptFive=true)：按实际计算金额收取(可能低于5元)
 *   - 不免五(exemptFive=false)：最低收取5元
 *
 * @param {number} amount - 交易金额(元)
 * @param {number} rate - 费率(百分数数值部分，如0.03表示0.03%)
 * @param {boolean} exemptFive - 是否免五
 * @returns {number} 费用金额(元，四舍五入到分)
 */
function calcFee(amount, rate, exemptFive) {
    // 交易费率：金额 × 费率(%) / 100，注意 rate 是百分数数值部分
    let fee = amount * (rate / 100);
    // 如果不免五，单笔最低收5元
    if (!exemptFive && fee < 5) {
        fee = 5;
    }
    // 四舍五入到2位小数(分)
    return Math.round(fee * 100) / 100;
}

/**
 * 获取回测结果排行榜(精简列表，剔除 daily_detail 大字段)
 * @returns {Promise<Array>} 回测结果列表
 */
async function getBacktestResults() {
    return await BacktestResult.getRankings();
}

/**
 * 获取单次回测的完整详情(含 daily_detail)
 * @param {number} id - 回测结果ID
 * @returns {Promise<Object>} 回测详情
 */
async function getBacktestDetail(id) {
    return await BacktestResult.find(id);
}

module.exports = {
    runBacktest,
    runParameterOptimization,
    getBacktestResults,
    getBacktestDetail
};
