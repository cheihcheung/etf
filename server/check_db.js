const db = require('./src/config/db');

(async () => {
    try {
        // 查策略A配置
        const stratA = await db.query("SELECT * FROM strategy_a_config LIMIT 3");
        console.log('=== strategy_a_config ===');
        console.log(JSON.stringify(stratA, null, 2));

        // 查策略A档位比例
        const stratARatio = await db.query("SELECT * FROM strategy_a_ratio LIMIT 10");
        console.log('\n=== strategy_a_ratio（档位比例，涉及哪些ETF）===');
        console.log(JSON.stringify(stratARatio, null, 2));

        // 查策略B档位比例
        const stratBRatio = await db.query("SELECT * FROM strategy_b_ratio LIMIT 10");
        console.log('\n=== strategy_b_ratio（档位比例，涉及哪些ETF）===');
        console.log(JSON.stringify(stratBRatio, null, 2));

    } catch (e) {
        console.error('Error:', e.message);
    }
    process.exit(0);
})();
