// ==========================================
// ETF多资产动态配置策略系统 - 数据库底座与连接池模块
// ==========================================
const mysql = require('mysql2/promise');
require('dotenv').config();

// 1. 初始化 MySQL2 Promise 连接池配置
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'rootMG2024',
    database: process.env.DB_NAME || 'etf',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20, // 最大连接限制，默认 20
    waitForConnections: true, // 连接不足时是否等待
    queueLimit: 0,            // 排队队列无上限限制
    enableKeepAlive: true,    // 开启心跳保活，防止 MySQL 自动断开闲置连接
    keepAliveInitialDelay: 0
});

/**
 * 2. 批量/通用数据查询方法
 * @param {string} sql 执行的 SELECT SQL 语句
 * @param {Array} params 绑定的防 SQL 注入参数数组
 * @returns {Promise<Array>} 查询返回的全部行数组
 */
async function query(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

/**
 * 3. 单行/单标的数据查询快捷方法
 * @param {string} sql 查询 SQL
 * @param {Array} params 参数数组
 * @returns {Promise<object|null>} 第一行记录，无结果则返回 null
 */
async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0] || null;
}

/**
 * 4. 写操作/更新删除执行方法
 * @param {string} sql INSERT/UPDATE/DELETE 语句
 * @param {Array} params 参数数组
 * @returns {Promise<object>} 执行结果元数据，如 insertId, affectedRows 等
 */
async function execute(sql, params = []) {
    const [result] = await pool.execute(sql, params);
    return result;
}

/**
 * 5. 数据库事务执行封装（支持回调操作）
 * 发生异常时会自动执行 ROLLBACK 回滚，成功后执行 COMMIT 提交并自动释放连接
 * @param {Function} callback 事务执行的回调异步函数
 * @returns {Promise<any>} 回调函数的返回结果
 */
async function transaction(callback) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction(); // 开启事务
        const result = await callback(connection); // 执行核心业务回调
        await connection.commit();           // 提交事务
        return result;
    } catch (error) {
        await connection.rollback();         // 遇到任何错误，一键回滚事务
        throw error;
    } finally {
        connection.release();                // 将连接退还给池中
    }
}

/**
 * 6. 实盘及启动时连接健康状态检测方法
 * @returns {Promise<boolean>} 是否连接成功
 */
async function testConnection() {
    try {
        const rows = await query('SELECT 1 as test');
        console.log('[DB] 数据库池初始化成功，心跳健康测试 (SELECT 1) 通过');
        return true;
    } catch (error) {
        console.error('[DB] 数据库池建立失败，请检查配置文件 .env 中数据库的配置参数。详情:', error.message);
        return false;
    }
}

module.exports = {
    pool,
    query,
    queryOne,
    execute,
    transaction,
    testConnection
};
