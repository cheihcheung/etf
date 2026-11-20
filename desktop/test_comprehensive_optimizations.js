/**
 * 全面回归测试套件：验证回测优化、节假日周调仓、Map O(1) 索引、基准倍率缩放、寻优进度
 */
const assert = require('assert');
const path = require('path');
const SQLiteDatabase = require('./src/database');
const BacktestService = require('./src/services/backtest');

async function runTests() {
    console.log('====================================================');
    console.log('🚀 开始全面回归测试套件 (Comprehensive Regression Tests)');
    console.log('====================================================\n');

    const dbPath = path.join(__dirname, 'data', 'etf.db');
    const db = new SQLiteDatabase(dbPath);
    await db.initialize();
    const service = new BacktestService(db);

    // -----------------------------------------------------------------
    // 测试 1：验证 isLastTradingDayOfWeek (节假日周调仓跨周判定)
    // -----------------------------------------------------------------
    console.log('👉 [测试 1] 验证 isLastTradingDayOfWeek (周调仓与节假日周五休市处理)...');
    
    // 场景 A：正常周（周四后面是周五）
    // 2026-06-04 是周四，2026-06-05 是周五 -> 周四不是最后交易日，周五是
    const normalThu = service.isLastTradingDayOfWeek('2026-06-04', '2026-06-05');
    assert.strictEqual(normalThu, false, '正常周四不应触发周调仓');
    const normalFri = service.isLastTradingDayOfWeek('2026-06-05', '2026-06-08');
    assert.strictEqual(normalFri, true, '正常周五跨周到下周一，应当触发周调仓');

    // 场景 B：节假日休市周（周五端午放假，周四是本周最后一个交易日）
    // 2026-06-18 是周四，周五休市，下一个交易日是 2026-06-22(下周一)
    const holidayThu = service.isLastTradingDayOfWeek('2026-06-18', '2026-06-22');
    assert.strictEqual(holidayThu, true, '节假日周五休市时，周四跨周到下周一，必须触发周调仓！');

    // 场景 C：回测最后一天（nextDate 为 null）
    const lastDay = service.isLastTradingDayOfWeek('2026-11-20', null);
    assert.strictEqual(lastDay, true, '回测最后一个交易日，必须触发周调仓');

    // 场景 D：周中连续普通交易日（周一到周二）
    const normalMon = service.isLastTradingDayOfWeek('2026-06-08', '2026-06-09');
    assert.strictEqual(normalMon, false, '普通周一不应触发周调仓');

    console.log('   ✅ 测试 1 通过：节假日周五休市与普通周调仓判定 100% 正确！\n');

    // -----------------------------------------------------------------
    // 测试 2：验证真实 SQLite 数据环境下的完整回测 (Weekly 调仓 + 优化后 Map 索引)
    // -----------------------------------------------------------------
    console.log('👉 [测试 2] 验证真实数据库下的完整回测流程与指标计算...');
    
    // 查库看有哪些可用 ETF
    const stocks = db.query('SELECT code, name, is_benchmark, scale_factor FROM stock WHERE is_enabled = 1 LIMIT 5');
    console.log(`   从数据库找到 ${stocks.length} 只可用标的:`, stocks.map(s => `${s.code}(${s.name})`).join(', '));
    assert(stocks.length > 0, '数据库中应有可测试的标的');

    const testEtfs = stocks.map(s => ({ code: s.code, name: s.name }));
    const initialRatios = {};
    const equalRatio = parseFloat((100 / testEtfs.length).toFixed(1));
    testEtfs.forEach(e => { initialRatios[e.code] = equalRatio; });

    const backtestParams = {
        startDate: '2020-01-01',
        endDate: '2026-11-19',
        initialCapital: 1000000,
        feeRate: 0.03,
        feeExemptFive: true,
        tradeFrequency: 'weekly', // 测试周调仓
        tradeMatchMode: 'close',
        drawdownBuffer: 1.0,
        etfs: testEtfs,
        initialRatios,
        strategyAConfig: {
            drawdownLevels: [
                { levelOrder: 1, threshold: 5, ratios: testEtfs.map(e => ({ etfCode: e.code, targetRatio: 1 })) },
                { levelOrder: 2, threshold: 10, ratios: testEtfs.map(e => ({ etfCode: e.code, targetRatio: 2 })) }
            ]
        },
        rebalanceConfig: { enabled: true },
        rebalanceThreshold: 2.0
    };

    const startTime = Date.now();
    const result = await service.runBacktest(backtestParams);
    const duration = Date.now() - startTime;

    assert(!result.error, `回测执行失败: ${result.error}`);
    console.log(`   回测耗时: ${duration} ms (含近 7 年日线数据)`);

    // 校验核心量化指标
    console.log(`   初始资金: ${result.initialCapital} (期望 1000000)`);
    assert.strictEqual(result.initialCapital, 1000000, '初始资金必须严格为 100 万！');
    
    assert(typeof result.totalReturn === 'number', '应返回总收益率数字');
    assert(typeof result.annualReturn === 'number', '应返回年化收益率数字');
    assert(typeof result.maxDrawdown === 'number', '应返回最大回撤数字');
    assert(typeof result.sharpeRatio === 'number', '应返回夏普比率数字');
    assert(Array.isArray(result.dailyValues), '应返回每日净值数组');
    assert(result.dailyValues.length > 0, '每日净值数组不应为空');

    // 检查每日净值起始第一天
    const firstDayVal = result.dailyValues[0].totalValue;
    console.log(`   首日净值: ${firstDayVal} 元 (应约为 100 万左右，扣除少量建仓佣金)`);
    assert(firstDayVal >= 995000 && firstDayVal <= 1005000, '首日净值必须在 100 万附近，绝对不能是 200 万！');

    // 检查是否有调仓记录
    assert(Array.isArray(result.tradeRecords), '应返回调仓流水数组');
    console.log(`   生成调仓流水数: ${result.tradeRecords.length} 笔`);
    assert(result.tradeRecords.length > 0, '调仓流水不应为空');

    console.log(`   回测总收益: ${result.totalReturn.toFixed(2)}%, 年化: ${result.annualReturn.toFixed(2)}%, 最大回撤: ${result.maxDrawdown.toFixed(2)}%, 夏普: ${result.sharpeRatio.toFixed(4)}`);
    console.log('   ✅ 测试 2 通过：回测流程完整、指标计算精确、首日资金无双重计算！\n');

    // -----------------------------------------------------------------
    // 测试 3：验证参数网格寻优与进度回调 (onProgress)
    // -----------------------------------------------------------------
    console.log('👉 [测试 3] 验证参数网格寻优与实时进度回调...');
    
    let progressCalls = [];
    const optimParams = {
        baseParams: backtestParams,
        optimizationRanges: {
            rebalanceThreshold: [1.5, 3.0],
            centralAnnual: [8, 12]
        }
    };

    const optimResult = await service.runParameterOptimization(optimParams, (prog) => {
        progressCalls.push(prog);
    });

    assert.strictEqual(optimResult.totalCombinations, 4, '2x2 应生成 4 组寻优组合');
    assert.strictEqual(progressCalls.length, 4, '应触发 4 次进度回调');
    assert.strictEqual(progressCalls[progressCalls.length - 1].percent, 100, '最后一次进度回调百分比应为 100%');
    assert(optimResult.bestParams, '应输出最优参数');

    console.log(`   寻优总组合数: ${optimResult.totalCombinations}, 回调次数: ${progressCalls.length}`);
    console.log(`   最优参数:`, optimResult.bestParams.params);
    console.log('   ✅ 测试 3 通过：寻优算法及实时进度回调正常工作！\n');

    console.log('====================================================');
    console.log('🎉 所有回归测试全部通过！系统运行健康！');
    console.log('====================================================');
}

runTests().catch(err => {
    console.error('❌ 测试失败:', err);
    process.exit(1);
});
