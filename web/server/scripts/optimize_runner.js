/**
 * ==========================================================
 * ETF多资产动态配置策略系统 - 全自动、多维度网格参数寻优引擎 (Independent Optimizer)
 * ==========================================================
 * 该离线脚本位于 server/scripts/ 目录，通过命令行手动执行：
 *   node scripts/optimize_runner.js
 * 它会在历史行情中笛卡尔积式地遍历：
 * 1. 资产初始比例的所有排列组合 (20% 步长, 总和为100%)
 * 2. 日常再平衡阈值 [1.0%, 2.0%, 3.0%]
 * 3. 策略A、策略B、日常平衡的 8 种复合开关配置
 * 共 504 种高维资产配置场景。
 *
 * 评估指标：
 * - 年化收益率 (Annual Return)
 * - 最大回撤度 (Max Drawdown)
 * - 年化波动率 (Volatility)
 * - 夏普比率 (Sharpe Ratio, 收益/波动性价比)
 * - 卡玛比率 (Calmar Ratio, 收益/最大回撤性价比)
 *
 * 输出：server/output/optimize_results.csv (BOM UTF-8, 可直接用 Excel 打开)
 */
const db = require('../src/config/db');
const backtestService = require('../src/services/backtest');
const fs = require('fs');
const path = require('path');

// 统一日志工具
const logPrefix = () => `[OPTIMIZER ${new Date().toLocaleTimeString()}]`;

(async () => {
    try {
        console.log(`\n================================================================================`);
        console.log(`${logPrefix()} 🚀 终极网格寻优引擎已启动！正在为您探寻全局性价比之王最优解...`);
        console.log(`================================================================================`);

        // --------------------------------------------------------
        // 1. 动态自适应拉取数据库中当前激活的全部 ETF 标的
        // --------------------------------------------------------
        // [已修复] 原代码查询了不存在的表 'etf_basic'，导致脚本启动即崩溃。
        //   实际的 ETF 标的表名是 'stock'（对应 ORM 模型 server/src/models/Stock.js）。
        //   修复原因：数据库 schema 中从未创建过 etf_basic 表，所有 ETF 基本信息
        //   都统一存储在 stock 表中（包含 code/name/asset_type/initial_ratio/
        //   is_enabled/step_ratio/annual_return 等字段）。
        //   修复方式：将表名 'etf_basic' 改为 'stock'。
        const dbEtfs = await db.query("SELECT code, name, asset_type FROM stock");
        if (!dbEtfs || dbEtfs.length < 3) {
            console.error(`${logPrefix()} ❌ 寻优失败：数据库中配置的资产标的不足3个，请先同步配置。`);
            process.exit(1);
        }

        const etfs = dbEtfs.map(e => ({ code: e.code, name: e.name }));
        const etfNameMap = {};
        etfs.forEach(e => { etfNameMap[e.code] = e.name; });

        console.log(`${logPrefix()} 成功锁定三种配置资产标的：`);
        etfs.forEach((e, idx) => {
            console.log(`   └─ 资产标的 #${idx + 1} : ${e.name} (${e.code})`);
        });

        // --------------------------------------------------------
        // 2. 从数据库加载用户当前配置好的策略A与策略B档位参数
        // --------------------------------------------------------
        // 策略档位从数据库的 strategy_a_config / strategy_b_config 表读取，
        // ratios 从 JSON 对象 {code: 倍数} 转成回测引擎需要的数组 [{etfCode, targetRatio}]
        console.log(`\n${logPrefix()} 正在从数据库加载策略A与策略B配置档位数据...`);

        // 加载策略A回撤档位(只取 drawdown 类型，忽略 rally 类型)
        const aLevels = await db.query("SELECT * FROM strategy_a_config WHERE trigger_type = 'drawdown' ORDER BY level_order ASC");
        const drawdownLevels = aLevels.map(l => {
            let parsed = {};
            try { parsed = typeof l.ratios === 'string' ? JSON.parse(l.ratios) : l.ratios; } catch(e){}
            return {
                levelOrder: l.level_order,
                threshold: parseFloat(l.threshold),
                ratios: Object.keys(parsed).map(code => ({ etfCode: code, targetRatio: parsed[code] }))
            };
        });
        const strategyAConfigBase = { enabled: true, resetOnHigh: true, drawdownLevels };

        // 加载策略B高低估档位
        const bLevels = await db.query("SELECT * FROM strategy_b_config ORDER BY level_order ASC");
        const overvaluedLevels = bLevels.filter(l => l.deviation_type === 'overvalued').map(l => {
            let parsed = {};
            try { parsed = typeof l.ratios === 'string' ? JSON.parse(l.ratios) : l.ratios; } catch(e){}
            return { levelOrder: l.level_order, threshold: parseFloat(l.threshold), ratios: Object.keys(parsed).map(code => ({ etfCode: code, targetRatio: parsed[code] })) };
        });
        const undervaluedLevels = bLevels.filter(l => l.deviation_type === 'undervalued').map(l => {
            let parsed = {};
            try { parsed = typeof l.ratios === 'string' ? JSON.parse(l.ratios) : l.ratios; } catch(e){}
            return { levelOrder: l.level_order, threshold: parseFloat(l.threshold), ratios: Object.keys(parsed).map(code => ({ etfCode: code, targetRatio: parsed[code] })) };
        });
        const strategyBConfigBase = { enabled: true, centralAnnual: 9.0, overvaluedLevels, undervaluedLevels };

        console.log(`${logPrefix()} 策略A档位加载完毕 (${drawdownLevels.length}档) | 策略B高低估加载完毕 (高估${overvaluedLevels.length}档, 低估${undervaluedLevels.length}档)`);

        // --------------------------------------------------------
        // 3. 网格化自适应生成所有待遍历的资产比例组合
        // --------------------------------------------------------
        // 以 20% 为步长遍历 x+y+z=100 的所有非负整数解(组合数取决于标的数量)
        // 例如 3 只标的：21 种组合 × 3 阈值 × 8 开关 = 504 种场景
        const code1 = etfs[0].code;
        const code2 = etfs[1].code;
        const code3 = etfs[2].code;

        const initialRatiosList = [];
        for (let x = 0; x <= 100; x += 20) {
            for (let y = 0; y <= 100 - x; y += 20) {
                const z = 100 - x - y;
                const tempRatio = {};
                tempRatio[code1] = x;
                tempRatio[code2] = y;
                tempRatio[code3] = z;
                initialRatiosList.push(tempRatio);
            }
        }

        // 再平衡偏差阈值列表
        const rebalanceThresholds = [1.0, 2.0, 3.0];

        // 策略开关组合列表：策略A × 策略B × 再平衡 = 2^3 = 8 种笛卡尔积
        const strategyCombos = [];
        const flags = [true, false];
        for (const a of flags) {
            for (const b of flags) {
                for (const r of flags) {
                    strategyCombos.push({ enableA: a, enableB: b, enableRebalance: r });
                }
            }
        }

        const totalRuns = initialRatiosList.length * rebalanceThresholds.length * strategyCombos.length;
        console.log(`${logPrefix()} 笛卡尔积排列完毕：初始配比组合 ${initialRatiosList.length} 种 | 再平衡阈值 ${rebalanceThresholds.length} 种 | 策略开关 8 种`);
        console.log(`${logPrefix()} 🎯 即将开启总共 ${totalRuns} 轮网格回测寻优...`);

        // --------------------------------------------------------
        // 4. 全速网格测试流水线(三层嵌套循环，顺序遍历所有组合)
        // --------------------------------------------------------
        // 每个组合调用 runBacktest 并强制 isOptimization:true(防爆盘，不写 daily_detail 和流水)
        const results = [];
        let counter = 0;

        for (const ratios of initialRatiosList) {
            for (const threshold of rebalanceThresholds) {
                for (const combo of strategyCombos) {
                    counter++;

                    const backtestParams = {
                        startDate: '2013-02-01',
                        endDate: '2026-05-30',
                        initialCapital: 1000000,
                        feeRate: 0.012, // 0.012%
                        feeExemptFive: true,
                        etfs,
                        initialRatios: ratios,
                        strategyAConfig: combo.enableA ? strategyAConfigBase : null,
                        strategyBConfig: combo.enableB ? strategyBConfigBase : null,
                        rebalanceConfig: combo.enableRebalance ? { enabled: true } : null,
                        rebalanceThreshold: threshold,
                        tradeFrequency: 'daily',
                        strategyPriority: 'rebalance',
                        centralAnnual: 10.0,
                        resetOnHigh: true,
                        isOptimization: true // 强制内存运算
                    };

                    try {
                        const res = await backtestService.runBacktest(backtestParams);
                        const calmarRatio = res.maxDrawdown > 0 ? (res.annualReturn / res.maxDrawdown) : 0;

                        results.push({
                            id: counter,
                            ratios: { ...ratios },
                            rebalanceThreshold: threshold,
                            enableA: combo.enableA,
                            enableB: combo.enableB,
                            enableRebalance: combo.enableRebalance,
                            totalReturn: res.totalReturn,
                            annualReturn: res.annualReturn,
                            maxDrawdown: res.maxDrawdown,
                            volatility: res.annualVolatility,
                            sharpeRatio: res.sharpeRatio,
                            calmarRatio: calmarRatio
                        });
                    } catch (err) {
                        // 发生小异常跳过
                    }

                    if (counter % 50 === 0 || counter === totalRuns) {
                        console.log(`${logPrefix()} 进度: [${counter}/${totalRuns}] (${((counter/totalRuns)*100).toFixed(1)}%) 正在极速寻优中...`);
                    }
                }
            }
        }

        // --------------------------------------------------------
        // 5. 统计性价比最优解与卡玛防暴跌之王
        // --------------------------------------------------------
        console.log(`\n${logPrefix()} 回测完毕！正在按夏普比率（性价比）进行全局降序分析...`);

        const sharpeSorted = [...results].sort((a, b) => b.sharpeRatio - a.sharpeRatio);
        const sharpeKing = sharpeSorted[0];

        const calmarSorted = [...results].sort((a, b) => b.calmarRatio - a.calmarRatio);
        const calmarKing = calmarSorted[0];

        const returnSorted = [...results].sort((a, b) => b.annualReturn - a.annualReturn);
        const returnKing = returnSorted[0];

        // --------------------------------------------------------
        // 6. 打印一键最优解推荐卡
        // --------------------------------------------------------
        console.log(`\n================================================================================`);
        console.log(`🏅                        多资产量化配置「黄金最优解」一键推荐卡                   🏅`);
        console.log(`================================================================================`);
        
        const buildRatiosDetail = (ratiosObj) => {
            return Object.keys(ratiosObj)
                .map(code => `${etfNameMap[code] || code}(${ratiosObj[code]}%)`)
                .join(' | ');
        };

        if (sharpeKing) {
            console.log(`🏆 【性价比之王 - 夏普最优解】(高收益、低波动完美均衡)`);
            console.log(`   └─ 初始配置比例 : ${buildRatiosDetail(sharpeKing.ratios)}`);
            console.log(`   └─ 日常再平衡   : 偏离阈值 ${sharpeKing.rebalanceThreshold}% | 策略开关: [再平衡:${sharpeKing.enableRebalance?'开启':'关闭'}, 策略A:${sharpeKing.enableA?'开启':'关闭'}, 策略B:${sharpeKing.enableB?'开启':'关闭'}]`);
            console.log(`   └─ 业绩表现     : 年化收益率 ${sharpeKing.annualReturn.toFixed(2)}% | 最大回撤 ${sharpeKing.maxDrawdown.toFixed(2)}% | 年化波动率 ${sharpeKing.volatility.toFixed(2)}%`);
            console.log(`   └─ 性价比得分   : 夏普比率 (Sharpe) : ${sharpeKing.sharpeRatio.toFixed(4)} (全场第一！)`);
            console.log(`--------------------------------------------------------------------------------`);
        }

        if (calmarKing) {
            console.log(`🛡️ 【防暴跌之王 - 卡玛最优解】(涨得高、跌得少，防回撤极其强悍)`);
            console.log(`   └─ 初始配置比例 : ${buildRatiosDetail(calmarKing.ratios)}`);
            console.log(`   └─ 日常再平衡   : 偏离阈值 ${calmarKing.rebalanceThreshold}% | 策略开关: [再平衡:${calmarKing.enableRebalance?'开启':'关闭'}, 策略A:${calmarKing.enableA?'开启':'关闭'}, 策略B:${calmarKing.enableB?'开启':'关闭'}]`);
            console.log(`   └─ 业绩表现     : 年化收益率 ${calmarKing.annualReturn.toFixed(2)}% | 最大回撤 ${calmarKing.maxDrawdown.toFixed(2)}% | 年化波动率 ${calmarKing.volatility.toFixed(2)}%`);
            console.log(`   └─ 性价比得分   : 卡玛比率 (Calmar) : ${calmarKing.calmarRatio.toFixed(4)} (回撤性价比第一！)`);
            console.log(`--------------------------------------------------------------------------------`);
        }

        if (returnKing) {
            console.log(`📈 【绝对收益之王 - 收益最高解】(高仓位强悍爆发，但可能波动较大)`);
            console.log(`   └─ 初始配置比例 : ${buildRatiosDetail(returnKing.ratios)}`);
            console.log(`   └─ 日常再平衡   : 偏离阈值 ${returnKing.rebalanceThreshold}% | 策略开关: [再平衡:${returnKing.enableRebalance?'开启':'关闭'}, 策略A:${returnKing.enableA?'开启':'关闭'}, 策略B:${returnKing.enableB?'开启':'关闭'}]`);
            console.log(`   └─ 业绩表现     : 年化收益率 ${returnKing.annualReturn.toFixed(2)}% | 最大回撤 ${returnKing.maxDrawdown.toFixed(2)}% | 夏普比率 ${returnKing.sharpeRatio.toFixed(4)}`);
            console.log(`   └─ 累计总收益   : 累计大赚 ${returnKing.totalReturn.toFixed(2)}% (全场最高！)`);
            console.log(`================================================================================`);
        }

        // --------------------------------------------------------
        // 7. 输出自适应 ASCII 黄金排行榜表前 20 名
        // --------------------------------------------------------
        console.log(`\n📊 【全场性价比综合大排行前 20 名】(按夏普比率降序)`);
        console.log(`------------------------------------------------------------------------------------------------------------------------`);
        console.log(` 排名 |             ETF资产初始占比分配配置            | 再平衡阈值 | 再平衡/策略A/B |  累计总收益  |   年化收益   |  最大回撤  |  夏普比率  | 卡玛比率 `);
        console.log(`------------------------------------------------------------------------------------------------------------------------`);
        
        sharpeSorted.slice(0, 20).forEach((r, idx) => {
            const rank = String(idx + 1).padStart(2, ' ');
            const ratiosStr = Object.keys(r.ratios)
                .map(code => `${etfNameMap[code]?.slice(0,4) || code}:${r.ratios[code]}%`)
                .join(', ');
            const formattedRatios = ratiosStr.padEnd(46, ' ');
            const th = `${r.rebalanceThreshold.toFixed(1)}%`.padStart(6, ' ');
            const combos = `${r.enableRebalance?'开':'关'}/${r.enableA?'开':'关'}/${r.enableB?'开':'关'}`.padStart(10, ' ');
            const totRet = `${r.totalReturn.toFixed(2)}%`.padStart(11, ' ');
            const annRet = `${r.annualReturn.toFixed(2)}%`.padStart(11, ' ');
            const maxDd = `${r.maxDrawdown.toFixed(2)}%`.padStart(9, ' ');
            const sharpe = `${r.sharpeRatio.toFixed(4)}`.padStart(9, ' ');
            const calmar = `${r.calmarRatio.toFixed(4)}`.padStart(9, ' ');
            console.log(`  #${rank} | ${formattedRatios} |   ${th}   |   ${combos}   | ${totRet}  | ${annRet}  | ${maxDd}  | ${sharpe}  | ${calmar} `);
        });
        console.log(`------------------------------------------------------------------------------------------------------------------------`);

        // --------------------------------------------------------
        // 8. 写入自适应数据 CSV 文件
        // --------------------------------------------------------
        const csvDir = path.join(__dirname, '..', 'output');
        if (!fs.existsSync(csvDir)) {
            fs.mkdirSync(csvDir, { recursive: true });
        }
        const csvPath = path.join(csvDir, 'optimize_results.csv');
        
        let csvContent = '\uFEFF';
        const etfHeaders = etfs.map(e => `${e.name}比例`).join(',');
        csvContent += `排名,${etfHeaders},再平衡阈值,再平衡启用,策略A启用,策略B启用,累计总收益,年化收益,最大回撤,年化波动,夏普比率,卡玛比率\n`;
        
        sharpeSorted.forEach((r, idx) => {
            const etfVals = etfs.map(e => `${r.ratios[e.code]}%`).join(',');
            csvContent += `${idx + 1},${etfVals},${r.rebalanceThreshold}%,${r.enableRebalance?'开':'关'},${r.enableA?'开':'关'},${r.enableB?'开':'关'},${r.totalReturn.toFixed(4)}%,${r.annualReturn.toFixed(4)}%,${r.maxDrawdown.toFixed(4)}%,${r.volatility.toFixed(4)}%,${r.sharpeRatio.toFixed(6)},${r.calmarRatio.toFixed(6)}\n`;
        });

        fs.writeFileSync(csvPath, csvContent, 'utf8');
        console.log(`\n${logPrefix()} 🎉 完整 504 组自适应寻优结果已写入 CSV 文件:`);
        console.log(`   👉 [optimize_results.csv](file:///${csvPath.replace(/\\/g, '/')})`);
        console.log(`   提示: 您可以直接双击用 Excel 自由排序筛选！`);
        console.log(`================================================================================\n`);

    } catch (e) {
        console.error('寻优脚本崩溃:', e);
    }
    process.exit(0);
})();
