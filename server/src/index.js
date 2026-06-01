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

app.use(cors({
  origin: ['http://localhost:8088', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/config', configRoutes);
app.use('/api/etf', etfRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/records', recordsRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use((err, req, res, next) => {
    logger.error(`服务器错误: ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: '服务器内部错误' });
});

async function startServer() {
    const dbConnected = await db.testConnection();
    if (!dbConnected) {
        logger.warn('数据库连接失败，服务将以有限功能启动');
    } else {
        // 自动静默检测并升级 stock 物理表结构，防重自诊断
        try {
            const columns = await db.query("SHOW COLUMNS FROM stock LIKE 'is_enabled'");
            if (columns.length === 0) {
                await db.execute("ALTER TABLE stock ADD COLUMN is_enabled TINYINT DEFAULT 1 COMMENT '是否启用(1启用,0禁用)'");
                logger.info('[DB] 成功为 stock 表追加 is_enabled 启用状态字段');
            }
            const stepCols = await db.query("SHOW COLUMNS FROM stock LIKE 'step_ratio'");
            if (stepCols.length === 0) {
                await db.execute("ALTER TABLE stock ADD COLUMN step_ratio DECIMAL(5,2) DEFAULT 5.00 COMMENT '加减比步长(%)'");
                logger.info('[DB] 成功为 stock 表追加 step_ratio 每档加减比步长字段');
            }
        } catch (alterError) {
            logger.error(`[DB] 自动检测升级 stock 表结构失败: ${alterError.message}`);
        }
    }

    function tryListen(port) {
        const server = app.listen(port, () => {
            logger.info(`ETF策略系统服务已启动，端口: ${port}`);
            logger.info(`API地址: http://localhost:${port}/api`);
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
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
