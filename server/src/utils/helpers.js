/**
 * ==========================================================================================
 * 量化指标计算函数库
 * ==========================================================================================
 * 本文件提供回测引擎所需的全套量化金融指标计算函数，所有公式均遵循主流金融学定义。
 * 这些函数被 services/backtest.js 调用，用于计算策略组合、沪深300基准、单只ETF 的各项指标。
 *
 * 【指标清单】
 *   - calcAnnualReturn       : 几何年化收益率(CAGR)
 *   - calcMaxDrawdown        : 最大回撤率
 *   - calcSharpeRatio        : 夏普比率(收益/波动性价比)
 *   - calcVolatility         : 年化波动率(基于日收益率标准差)
 *   - calcCurrentDrawdown    : 当前回撤率(相对历史最高点)
 *   - calcRallyPercent       : 反弹幅度(相对历史最低点)
 *   - calcAnnualReturnFromDates : 根据日期区间计算年化收益率
 *   - checkRatioSum          : 校验比例数组总和是否为100%
 *   - sleep                  : 异步延时工具(爬虫限流用)
 *
 * 【关键参数说明】
 *   - 年化因子 252  : 一年约252个交易日，用于把日波动率年化
 *   - 无风险利率 2.5%: 国内常用的无风险利率基准(夏普比率计算用)，在 backtest.js 中传入
 * ==========================================================================================
 */

/**
 * 计算几何年化收益率(CAGR, Compound Annual Growth Rate)
 *
 * 公式: annualReturn = (1 + totalReturn)^(1/years) - 1
 *   其中 totalReturn 为百分数(如 50 表示 50%)，years 为年数。
 *
 * 【为什么用几何年化】几何年化考虑了复利效应，比算术平均更准确地反映长期真实收益。
 *   例如 2 年涨 21%，年化 = (1.21)^(1/2) - 1 = 10%，而非 21%/2 = 10.5%。
 *
 * @param {number} totalReturn - 累计总收益率(百分数，如 50 表示 +50%)
 * @param {number} years - 持有年数
 * @returns {number} 年化收益率(百分数)，边界情况(年数≤0 或 总收益≤-100%)返回0
 */
function calcAnnualReturn(totalReturn, years) {
  // 边界保护：年数≤0或本金归零(收益≤-100%)无法计算，返回0
  if (years <= 0 || totalReturn <= -100) return 0;
  return (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
}

/**
 * 计算最大回撤率(Max Drawdown)
 *
 * 【定义】在净值序列的任意历史高点到其后续最低点的最大跌幅百分比。
 *   衡量「最糟糕的情况下会亏多少」，是风险控制的核心指标。
 *
 * 【算法】单次遍历，维护两个变量：
 *   - maxValue : 遍历到的历史最高净值
 *   - maxDrawdown : 历史最大回撤幅度
 *   对每个点计算 (maxValue - current) / maxValue，更新最大值。
 *
 * @param {number[]} values - 净值序列(如每日组合总市值)
 * @returns {number} 最大回撤率(正数百分数，如 30 表示最大回撤30%)，数据不足返回0
 */
function calcMaxDrawdown(values) {
  if (!values || values.length < 2) return 0;
  let maxValue = values[0];  // 历史最高净值
  let maxDrawdown = 0;       // 最大回撤
  for (let i = 1; i < values.length; i++) {
    // 更新历史最高点
    if (values[i] > maxValue) {
      maxValue = values[i];
    }
    // 计算当前点相对历史最高点的回撤幅度
    const drawdown = (maxValue - values[i]) / maxValue * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  return maxDrawdown;
}

/**
 * 计算夏普比率(Sharpe Ratio)
 *
 * 公式: Sharpe = (annualReturn - riskFreeRate) / annualVolatility
 *   衡量「每承担1单位风险获得多少超额收益」，数值越高性价比越好。
 *   通常 > 1 算优秀，> 2 算极好。
 *
 * @param {number} annualReturn - 年化收益率(百分数)
 * @param {number} riskFreeRate - 无风险利率(百分数)，本系统默认 2.5%(国内常用基准)
 * @param {number} annualVolatility - 年化波动率(百分数)
 * @returns {number} 夏普比率，波动率为0时返回0(避免除零)
 */
function calcSharpeRatio(annualReturn, riskFreeRate, annualVolatility) {
  // 波动率为0无法计算(避免除零)，返回0
  if (annualVolatility <= 0) return 0;
  return (annualReturn - riskFreeRate) / annualVolatility;
}

/**
 * 计算年化波动率(Annualized Volatility)
 *
 * 【算法】
 *   1. 计算日收益率的样本标准差(分母用 n-1，即贝塞尔校正)
 *   2. 乘以 √252 年化(一年约252个交易日)
 *
 * 公式: volatility = sqrt( variance × 252 )
 *   其中 variance = Σ(xi - mean)² / (n - 1)
 *
 * 【为什么用 n-1】样本方差用 n-1 而非 n 是无偏估计，更接近总体真实方差。
 *
 * @param {number[]} dailyReturns - 日收益率序列(百分数)
 * @returns {number} 年化波动率(百分数)，数据不足返回0
 */
function calcVolatility(dailyReturns) {
  if (!dailyReturns || dailyReturns.length < 2) return 0;
  // 计算日收益率均值
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  // 计算样本方差(分母 n-1)
  const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (dailyReturns.length - 1);
  // 年化：方差 × 252 后开方
  return Math.sqrt(variance * 252);
}

/**
 * 计算当前回撤率(相对历史最高净值)
 *
 * 与 calcMaxDrawdown 不同，这个只计算「当前点」相对历史最高的回撤，不遍历整个序列。
 * 用于策略A的实时回撤判断。
 *
 * @param {number} currentValue - 当前净值
 * @param {number} historyHighValue - 历史最高净值
 * @returns {number} 当前回撤率(正数百分数)，历史最高≤0返回0
 */
function calcCurrentDrawdown(currentValue, historyHighValue) {
  if (historyHighValue <= 0) return 0;
  return (historyHighValue - currentValue) / historyHighValue * 100;
}

/**
 * 计算反弹幅度(相对历史最低点)
 *
 * 用于策略A判断从低点的反弹幅度，作为退档信号依据。
 *
 * @param {number} currentValue - 当前净值
 * @param {number} lowValue - 历史最低净值
 * @returns {number} 反弹幅度(正数百分数)，最低点≤0返回0
 */
function calcRallyPercent(currentValue, lowValue) {
  if (lowValue <= 0) return 0;
  return (currentValue - lowValue) / lowValue * 100;
}

/**
 * 根据日期区间计算年化收益率(封装 calcAnnualReturn)
 *
 * 自动从 startDate 和 endDate 计算持有年数，再调用 calcAnnualReturn。
 *
 * @param {number} totalReturn - 累计总收益率(百分数)
 * @param {string} startDate - 起始日期 'YYYY-MM-DD'
 * @param {string} endDate - 结束日期 'YYYY-MM-DD'
 * @returns {number} 年化收益率(百分数)
 */
function calcAnnualReturnFromDates(totalReturn, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = (end - start) / (1000 * 60 * 60 * 24); // 毫秒差转天数
  const years = days / 365;                            // 按365天/年换算(忽略闰年微小差异)
  return calcAnnualReturn(totalReturn, years);
}

/**
 * 校验比例数组总和是否为100%(用于配置校验)
 *
 * 由于浮点数精度问题，用 0.01 的容差判断而不是严格等于100。
 *
 * @param {number[]} ratios - 比例数组(如 [30, 40, 30])
 * @returns {boolean} 总和是否等于100%(容差0.01)
 */
function checkRatioSum(ratios) {
  const sum = ratios.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) < 0.01;
}

/**
 * 异步延时工具(用于爬虫限流，避免请求过快被风控)
 * @param {number} ms - 延时毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  calcAnnualReturn,
  calcMaxDrawdown,
  calcSharpeRatio,
  calcVolatility,
  calcCurrentDrawdown,
  calcRallyPercent,
  calcAnnualReturnFromDates,
  checkRatioSum,
  sleep
};
