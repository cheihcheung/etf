const db = require('../src/config/db');

(async () => {
    try {
        console.log('[MIGRATE] 正在尝试强制连接数据库...');
        const columns = await db.query("SHOW COLUMNS FROM etf_basic LIKE 'is_enabled'");
        if (columns.length === 0) {
            await db.execute("ALTER TABLE etf_basic ADD COLUMN is_enabled TINYINT DEFAULT 1 COMMENT '是否启用(1启用,0禁用)'");
            console.log('[MIGRATE] 成功为 etf_basic 表追加 is_enabled 字段');
        } else {
            console.log('[MIGRATE] is_enabled 字段已存在，无需追加');
        }
        
        const stepCols = await db.query("SHOW COLUMNS FROM etf_basic LIKE 'step_ratio'");
        if (stepCols.length === 0) {
            await db.execute("ALTER TABLE etf_basic ADD COLUMN step_ratio DECIMAL(5,2) DEFAULT 5.00 COMMENT '加减比步长(%)'");
            console.log('[MIGRATE] 成功为 etf_basic 表追加 step_ratio 字段');
        } else {
            console.log('[MIGRATE] step_ratio 字段已存在，无需追加');
        }
        console.log('[MIGRATE] 数据库物理迁移圆满成功！');
    } catch (e) {
        console.error('[MIGRATE] 数据库迁移失败:', e.message);
    }
    process.exit(0);
})();
