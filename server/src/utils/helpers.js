function calcAnnualReturn(totalReturn, years) {
  if (years <= 0 || totalReturn <= -100) return 0;
  return (Math.pow(1 + totalReturn / 100, 1 / years) - 1) * 100;
}

function calcMaxDrawdown(values) {
  if (!values || values.length < 2) return 0;
  let maxValue = values[0];
  let maxDrawdown = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > maxValue) {
      maxValue = values[i];
    }
    const drawdown = (maxValue - values[i]) / maxValue * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  return maxDrawdown;
}

function calcSharpeRatio(annualReturn, riskFreeRate, annualVolatility) {
  if (annualVolatility <= 0) return 0;
  return (annualReturn - riskFreeRate) / annualVolatility;
}

function calcVolatility(dailyReturns) {
  if (!dailyReturns || dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance * 252);
}

function calcCurrentDrawdown(currentValue, historyHighValue) {
  if (historyHighValue <= 0) return 0;
  return (historyHighValue - currentValue) / historyHighValue * 100;
}

function calcRallyPercent(currentValue, lowValue) {
  if (lowValue <= 0) return 0;
  return (currentValue - lowValue) / lowValue * 100;
}

function calcAnnualReturnFromDates(totalReturn, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = (end - start) / (1000 * 60 * 60 * 24);
  const years = days / 365;
  return calcAnnualReturn(totalReturn, years);
}

function checkRatioSum(ratios) {
  const sum = ratios.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) < 0.01;
}

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
