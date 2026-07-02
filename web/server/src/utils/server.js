/**
 * ==========================================================================================
 * 多资产策略回测系统 - 服务器启动工具模块
 * ==========================================================================================
 * 封装端口监听逻辑，支持端口被占用时自动 +1 重试。
 * ==========================================================================================
 */
const db = require("../config/db");
const logger = require("./logger");

/**
 * 递归尝试监听端口，被占用(EADDRINUSE)时自动+1重试
 * @param {object} app  - Express 应用实例
 * @param {number} port - 尝试监听的端口
 */
function tryListen(app, port) {
    const server = app.listen(port, () => {
        logger.info(`多资产策略回测系统服务已启动，端口: ${port}`);
        logger.info(`API地址: http://localhost:${port}/api`);
    });
    
    // 增加连接超时时间为 10 分钟 (600,000 毫秒)
    server.timeout = 600000;
    server.requestTimeout = 600000;
    server.headersTimeout = 610000;

    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            logger.warn(`端口 ${port} 被占用，尝试端口 ${port + 1}`);
            tryListen(app, port + 1);
        } else {
            logger.error(`服务器启动失败: ${err.message}`);
        }
    });
}

/**
 * 启动服务器
 * 1. 测试数据库连接
 * 2. 自动迁移检测表结构(增加 is_benchmark 字段)
 * 3. 监听端口(占用则自动递增)
 * @param {object} app  - Express 应用实例
 * @param {number} port - 监听端口
 */
async function startServer(app, port) {
    await db.testConnection();
    tryListen(app, port);
}

module.exports = { startServer };
