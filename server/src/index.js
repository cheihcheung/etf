/**
 * ==========================================================================================
 * ETF 多资产动态配置策略系统 —— 后端 Express 应用入口
 * ==========================================================================================
 * 职责：
 *   1. 创建 Express 应用，配置 CORS、JSON 解析、路由挂载
 *   2. 启动时测试数据库连接
 *   3. 启动时自动热迁移 stock 表(检测并追加 is_enabled、step_ratio 字段)
 *   4. 监听端口(默认3001，被占用则自动+1)
 *
 * 【路由前缀】所有业务接口统一挂在 /api 下：
 *   - /api/config   : 初始配比、策略A/B 配置
 *   - /api/etf      : ETF 增删改查、行情同步、历史K线
 *   - /api/backtest : 回测执行、参数寻优、结果查询
 *   - /api/records  : 交易流水、市值查询
 *   - /api/health   : 健康检查
 *
 * 【热迁移机制】
 *   is_enabled 和 step_ratio 是后期演进加入的字段，为兼容旧库，启动时检测是否存在，
 *   不存在则自动 ALTER TABLE 追加。这样旧数据库升级时无需手动改表结构。
 * ==========================================================================================
 */
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');
const logger = require('./utils/logger');
const spider = require('./services/spider');
const configRoutes = require('./routes/config');
const etfRoutes = require('./routes/etf');
const backtestRoutes = require('./routes/backtest');
const recordsRoutes = require('./routes/records');

const app = express();
const PORT = parseInt(process.env.SERVER_PORT) || 3001;

// CORS 配置：允许前端开发服务器(8088 Vite / 5173 Vite默认)跨域访问
app.use(cors({
  origin: ['http://localhost:8088', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// JSON body 大小限制 50mb(回测参数可能包含较大的策略配置)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// 挂载业务路由(统一 /api 前缀)
app.use('/api/config', configRoutes);
app.use('/api/etf', etfRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/records', recordsRoutes);

// 健康检查接口(前端 Layout 组件定时调用)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// 全局错误处理中间件(捕获路由中未处理的异常)
app.use((err, req, res, next) => {
    logger.error(`服务器错误: ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: '服务器内部错误' });
});

/**
 * 启动服务器主流程
 * 1. 测试数据库连接
 * 2. 热迁移 stock 表结构
 * 3. 监听端口(占用则自动递增)
 */
async function startServer() {
    // 测试数据库连接
    const dbConnected = await db.testConnection();
    if (!dbConnected) {
        logger.warn('数据库连接失败，服务将以有限功能启动');
    } else {
        // 热迁移：自动检测并升级 stock 物理表结构
        // 这两个字段是后期演进加入的，旧库升级时自动补齐，无需手动改表
        try {
            // 检测 is_enabled 字段(是否启用)，不存在则追加
            const columns = await db.query("SHOW COLUMNS FROM stock LIKE 'is_enabled'");
            if (columns.length === 0) {
                await db.execute("ALTER TABLE stock ADD COLUMN is_enabled TINYINT DEFAULT 1 COMMENT '是否启用(1启用,0禁用)'");
                logger.info('[DB] 成功为 stock 表追加 is_enabled 启用状态字段');
            }
            // 检测 step_ratio 字段(加减比步长)，不存在则追加
            const stepCols = await db.query("SHOW COLUMNS FROM stock LIKE 'step_ratio'");
            if (stepCols.length === 0) {
                await db.execute("ALTER TABLE stock ADD COLUMN step_ratio DECIMAL(5,2) DEFAULT 5.00 COMMENT '加减比步长(%)'");
                logger.info('[DB] 成功为 stock 表追加 step_ratio 每档加减比步长字段');
            }
            // 自动追加 annual_return 字段（ETF 目标年化收益率，用于历史走势对比基准线）
            const annualCols = await db.query("SHOW COLUMNS FROM stock LIKE 'annual_return'");
            if (annualCols.length === 0) {
                await db.execute("ALTER TABLE stock ADD COLUMN annual_return DECIMAL(6,2) DEFAULT NULL COMMENT '目标年化收益率(%)'");
                logger.info('[DB] 成功为 stock 表追加 annual_return 目标年化收益率字段');
            }
            // 自动追加 scale_factor 字段（指数/ETF价格缩小倍率）
            const scaleCols = await db.query("SHOW COLUMNS FROM stock LIKE 'scale_factor'");
            if (scaleCols.length === 0) {
                await db.execute("ALTER TABLE stock ADD COLUMN scale_factor INT DEFAULT 1 COMMENT '价格缩小倍率'");
                logger.info('[DB] 成功为 stock 表追加 scale_factor 价格缩小倍率字段');
            }
        } catch (alterError) {
            logger.error(`[DB] 自动检测升级 stock 表结构失败: ${alterError.message}`);
        }

        // 自动检测并扩展 strategy_b_config 表的 deviation_type 枚举，以支持全局配置行
        try {
            const enumCheck = await db.query(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'strategy_b_config' AND COLUMN_NAME = 'deviation_type'"
            );
            if (enumCheck.length > 0 && !enumCheck[0].COLUMN_TYPE.includes('global_config')) {
                await db.execute(
                    "ALTER TABLE strategy_b_config MODIFY COLUMN deviation_type ENUM('overvalued','undervalued','global_config') NOT NULL COMMENT '偏离类型：overvalued高估/undervalued低估/global_config全局配置'"
                );
                logger.info('[DB] 成功将 strategy_b_config.deviation_type 扩展为支持 global_config');
            }
        } catch (alterError) {
            logger.error(`[DB] 自动检测升级 strategy_b_config 表结构失败: ${alterError.message}`);
        }

        // 自动检测并扩展 trade_records.trade_type 枚举，以支持 'init' 和 'backtest' 等回测类型
        try {
            const tradeTypeCheck = await db.query(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trade_records' AND COLUMN_NAME = 'trade_type'"
            );
            if (tradeTypeCheck.length > 0 && !tradeTypeCheck[0].COLUMN_TYPE.includes('init')) {
                await db.execute(
                    "ALTER TABLE trade_records MODIFY COLUMN trade_type ENUM('rebalance','strategy_a','strategy_b','manual','init','backtest') NOT NULL COMMENT '调仓类型'"
                );
                logger.info('[DB] 成功将 trade_records.trade_type 扩展为支持 init/backtest 类型');
            }
        } catch (alterError) {
            logger.error(`[DB] 自动检测升级 trade_records 表结构失败: ${alterError.message}`);
        }
    }

    /**
     * 递归尝试监听端口，被占用(EADDRINUSE)时自动+1重试
     * @param {number} port - 尝试监听的端口
     */
    function tryListen(port) {
        const server = app.listen(port, () => {
            logger.info(`ETF策略系统服务已启动，端口: ${port}`);
            logger.info(`API地址: http://localhost:${port}/api`);
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                // 端口被占用，自动尝试下一个端口
                logger.warn(`端口 ${port} 被占用，尝试端口 ${port + 1}`);
                tryListen(port + 1);
            } else {
                logger.error(`服务器启动失败: ${err.message}`);
            }
        });
    }
    tryListen(PORT);
}

startServer();
