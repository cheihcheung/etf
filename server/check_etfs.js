const db = require('./src/config/db');

(async () => {
    try {
        const etfs = await db.query("SELECT code, name, asset_type, initial_ratio FROM etf_basic");
        console.log('=== 数据库中配置的所有 ETF 基础信息 ===');
        console.log(JSON.stringify(etfs, null, 2));
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
})();
