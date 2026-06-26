/**
 * ==========================================================================================
 * 通用工具函数库（web 独立版）
 * ==========================================================================================
 * 提供量化指标计算、异步工具、日期切片等纯函数，不依赖任何数据库或运行时环境。
 * 被 web/server/src/services/backtest.js 引用。
 * ==========================================================================================
 */

/**
 * 计算几何年化收益率(CAGR)
 * 公式: (1 + totalReturn/100)^(1/years) - 1，结果转回百分数
 */
function calcAnnualReturn(totalReturn, years) {
    if (years <= 0 || totalReturn <= -100) return 0;
    return (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
}

/**
 * 计算最大回撤率
 * 单次遍历，维护历史最高净值，计算任意高点到后续最低点的最大跌幅
 */
function calcMaxDrawdown(values) {
    if (!values || values.length < 2) return 0;
    let maxValue = values[0];
    let maxDrawdown = 0;
    for (let i = 1; i < values.length; i++) {
        if (values[i] > maxValue) maxValue = values[i];
        const drawdown = (maxValue - values[i]) / maxValue * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    return maxDrawdown;
}

/**
 * 计算夏普比率
 * (annualReturn - riskFreeRate) / annualVolatility，波动率为0时返回0
 */
function calcSharpeRatio(annualReturn, riskFreeRate, annualVolatility) {
    if (annualVolatility <= 0) return 0;
    return (annualReturn - riskFreeRate) / annualVolatility;
}

/**
 * 计算年化波动率（基于日收益率标准差，乘 √252 年化）
 */
function calcVolatility(dailyReturns) {
    if (!dailyReturns || dailyReturns.length < 2) return 0;
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (dailyReturns.length - 1);
    return Math.sqrt(variance * 252);
}

/**
 * 计算当前回撤率（相对历史最高净值）
 */
function calcCurrentDrawdown(currentValue, historyHighValue) {
    if (historyHighValue <= 0) return 0;
    return (historyHighValue - currentValue) / historyHighValue * 100;
}

/**
 * 计算反弹幅度（相对历史最低点）
 */
function calcRallyPercent(currentValue, lowValue) {
    if (lowValue <= 0) return 0;
    return (currentValue - lowValue) / lowValue * 100;
}

/**
 * 根据日期区间计算年化收益率
 */
function calcAnnualReturnFromDates(totalReturn, startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = (end - start) / (1000 * 60 * 60 * 24);
    const years = days / 365;
    return calcAnnualReturn(totalReturn, years);
}

/**
 * 校验比例数组总和是否为100%（容差0.01）
 */
function checkRatioSum(ratios) {
    const sum = ratios.reduce((a, b) => a + b, 0);
    return Math.abs(sum - 100) < 0.01;
}

/**
 * 异步延时（爬虫限流用）
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 将起止日期按自然年切片
 * 用于历史行情批量抓取时避免单次请求时间跨度太大导致超时
 */
function splitYears(startDate, endDate) {
    const years = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    let year = start.getFullYear();
    while (true) {
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year + 1, 0, 1);
        const segStart = yearStart < start ? start : yearStart;
        const segEnd = yearEnd > end ? end : yearEnd;
        years.push({
            start: segStart.toISOString().slice(0, 10),
            end: segEnd.toISOString().slice(0, 10)
        });
        if (yearEnd >= end) break;
        year++;
    }
    return years;
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
    sleep,
    splitYears
};
