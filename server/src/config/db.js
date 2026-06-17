/**
 * ==========================================================================================
 * ETF多资产动态配置策略系统 - 数据库底座与连接池模块
 * ==========================================================================================
 * 基于 mysql2/promise 构建，提供全局唯一的 MySQL 连接池和事务封装。
 * 所有 BaseModel 的 CRUD 方法最终都调用这里的 query/queryOne/execute/transaction。
 *
 * 【连接池参数说明】
 *   - connectionLimit: 最大连接数(默认20)，高并发回测寻优时可适当调大
 *   - waitForConnections: 连接耗尽时是否排队等待(而非直接报错)
 *   - queueLimit: 0 表示排队无上限
 *   - enableKeepAlive: 心跳保活，防止 MySQL 的 wait_timeout 自动断开闲置连接
 *
 * 【配置来源】所有参数优先读取 .env 环境变量，缺省时使用代码内默认值。
 *
 * 【导出方法】
 *   - pool          : 原始连接池(特殊场景直接使用)
 *   - query         : 通用 SELECT 查询，返回行数组
 *   - queryOne      : 查询单行，返回首条或 null
 *   - execute       : INSERT/UPDATE/DELETE 执行，返回影响元数据
 *   - transaction   : 事务封装，回调内执行多条语句，异常自动回滚
 *   - testConnection: 健康检查(SELECT 1)，启动时调用
 * ==========================================================================================
 */
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
