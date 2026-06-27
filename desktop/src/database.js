/**
 * ==========================================================================================
 * SQLite 数据库封装模块
 * ==========================================================================================
 * 基于 better-sqlite3 提供 SQLite 数据库操作
 * 支持事务、预编译语句、批量操作
 * ==========================================================================================
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class SQLiteDatabase {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
    }

    /**
     * 初始化数据库连接并创建表结构
     */
    async initialize() {
        // 确保数据目录存在
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        // 创建数据库连接
        this.db = new Database(this.dbPath);

        // 启用外键约束
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');

        // 创建表结构
        this.createTables();

        // 执行数据库迁移
        this.runMigrations();

        return this;
    }

    /**
     * 执行数据库迁移
     */
    runMigrations() {
        const stockColumns = this.db.pragma('table_info(stock)');
        const hasAnnualReturn = stockColumns.some(col => col.name === 'annual_return');
        const hasScaleFactor = stockColumns.some(col => col.name === 'scale_factor');

        if (!hasAnnualReturn) {
            this.db.exec('ALTER TABLE stock ADD COLUMN annual_return DECIMAL(10,4) DEFAULT NULL');
        }

        if (!hasScaleFactor) {
            this.db.exec('ALTER TABLE stock ADD COLUMN scale_factor INTEGER DEFAULT 1');
        }
    }

    /**
     * 创建所有表结构
     */
    createTables() {
        // ETF 基础信息表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS stock (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(100),
                asset_type VARCHAR(50),
                current_price DECIMAL(12,4) DEFAULT 0.0000,
                change_pct DECIMAL(10,4) DEFAULT 0.0000,
                initial_ratio DECIMAL(10,4) DEFAULT 0.0000,
                is_enabled TINYINT DEFAULT 1,
                step_ratio DECIMAL(5,2) DEFAULT 5.00,
                is_benchmark TINYINT DEFAULT 0,
                annual_return DECIMAL(10,4) DEFAULT NULL,
                scale_factor INTEGER DEFAULT 1,
                update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 历史行情数据表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS history_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                etf_code VARCHAR(20) NOT NULL,
                trade_date DATE NOT NULL,
                open_price DECIMAL(12,4) DEFAULT 0.0000,
                close_price DECIMAL(12,4) NOT NULL,
                high_price DECIMAL(12,4) DEFAULT 0.0000,
                low_price DECIMAL(12,4) DEFAULT 0.0000,
                volume BIGINT DEFAULT 0,
                change_pct DECIMAL(10,4) DEFAULT 0.0000,
                UNIQUE(etf_code, trade_date)
            )
        `);

        // 交易记录表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS trade_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_time DATETIME NOT NULL,
                trade_type VARCHAR(20) NOT NULL,
                etf_code VARCHAR(20) NOT NULL,
                trade_direction VARCHAR(10) NOT NULL,
                shares DECIMAL(16,2) NOT NULL,
                price DECIMAL(12,4) NOT NULL,
                amount DECIMAL(16,2) NOT NULL,
                fee DECIMAL(12,2) DEFAULT 0.00,
                before_ratio DECIMAL(10,4),
                after_ratio DECIMAL(10,4),
                reason VARCHAR(500),
                trigger_detail TEXT
            )
        `);

        // 回测结果表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS backtest_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(200),
                params TEXT,
                total_return DECIMAL(12,4),
                annual_return DECIMAL(12,4),
                max_drawdown DECIMAL(12,4),
                annual_volatility DECIMAL(12,4),
                sharpe_ratio DECIMAL(12,4),
                daily_detail TEXT,
                create_time DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 策略A配置表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS strategy_a_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trigger_type VARCHAR(20) NOT NULL,
                level_order INTEGER NOT NULL,
                threshold DECIMAL(10,4) NOT NULL,
                ratios TEXT NOT NULL,
                update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(trigger_type, level_order)
            )
        `);

        // 策略B配置表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS strategy_b_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                deviation_type VARCHAR(20) NOT NULL,
                level_order INTEGER NOT NULL,
                threshold DECIMAL(10,4) NOT NULL,
                ratios TEXT NOT NULL,
                update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(deviation_type, level_order)
            )
        `);

        // 创建索引
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_history_etf_code ON history_data(etf_code);
            CREATE INDEX IF NOT EXISTS idx_history_date ON history_data(trade_date);
            CREATE INDEX IF NOT EXISTS idx_trade_time ON trade_records(trade_time);
            CREATE INDEX IF NOT EXISTS idx_trade_etf_code ON trade_records(etf_code);
            CREATE INDEX IF NOT EXISTS idx_backtest_time ON backtest_results(create_time)
        `);
    }

    /**
     * 执行查询，返回所有结果
     * 将结果转换为纯 JSON 对象，确保可以通过 IPC 传递
     */
    query(sql, params = []) {
        const stmt = this.db.prepare(sql);
        const results = stmt.all(...params);
        // 深拷贝结果，移除所有不可序列化的属性
        return JSON.parse(JSON.stringify(results));
    }

    /**
     * 执行查询，返回第一条结果
     * 将结果转换为纯 JSON 对象，确保可以通过 IPC 传递
     */
    queryOne(sql, params = []) {
        const stmt = this.db.prepare(sql);
        const result = stmt.get(...params);
        if (!result) return null;
        // 深拷贝结果，移除所有不可序列化的属性
        return JSON.parse(JSON.stringify(result));
    }

    /**
     * 执行 INSERT/UPDATE/DELETE
     * 返回纯 JSON 对象，确保可以通过 IPC 传递
     */
    execute(sql, params = []) {
        const stmt = this.db.prepare(sql);
        const result = stmt.run(...params);
        // better-sqlite3 的 run() 返回对象包含 changes, lastInsertRowid 等
        // 深拷贝确保移除所有不可序列化的属性
        return JSON.parse(JSON.stringify({
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid
        }));
    }

    /**
     * 执行事务
     */
    transaction(callback) {
        const txn = this.db.transaction(callback);
        return txn();
    }

    /**
     * 批量插入
     */
    batchInsert(sql, rows) {
        const insert = this.db.prepare(sql);
        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                insert.run(...item);
            }
        });
        return insertMany(rows);
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = SQLiteDatabase;