/**
 * ==========================================================================================
 * 多资产策略回测系统 —— 后端 Express 应用入口
 * ==========================================================================================
 * 职责：
 *   1. 创建 Express 应用，配置 CORS、JSON 解析、路由挂载
 *   2. 启动时测试数据库连接
 *   3. 监听端口(默认3001，被占用则自动+1)
 *
 * 【路由前缀】所有业务接口统一挂在 /api 下：
 *   - /api/config   : 初始配比、策略A/B 配置
 *   - /api/etf      : ETF 增删改查、行情同步、历史K线
 *   - /api/backtest : 回测执行、参数寻优、结果查询
 *   - /api/records  : 交易流水、市值查询
 *   - /api/health   : 健康检查
 * ==========================================================================================
 */
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const logger = require("./utils/logger");
const { startServer } = require("./utils/server");
const spider = require("./services/spider");
const configRoutes = require("./routes/config");
const etfRoutes = require("./routes/etf");
const backtestRoutes = require("./routes/backtest");
const recordsRoutes = require("./routes/records");
const importRoutes = require("./routes/import");

const app = express();
const PORT = parseInt(process.env.SERVER_PORT) || 3001;

// CORS 配置：允许前端开发服务器(8088 Vite / 5173 Vite默认)跨域访问
app.use(
    cors({
        origin: ["http://localhost:8088", "http://localhost:5173"],
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
    }),
);
// JSON body 大小限制 50mb(回测参数可能包含较大的策略配置)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// 挂载业务路由(统一 /api 前缀)
app.use("/api/config", configRoutes);
app.use("/api/etf", etfRoutes);
app.use("/api/backtest", backtestRoutes);
app.use("/api/records", recordsRoutes);
app.use("/api/import", importRoutes);

// 健康检查接口(前端 Layout 组件定时调用)
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
});

// 全局错误处理中间件(捕获路由中未处理的异常)
app.use((err, req, res, next) => {
    logger.error(`服务器错误: ${err.message}`, { stack: err.stack });
    res.status(500).json({ success: false, message: "服务器内部错误" });
});

/**
 * 启动服务器
 */
startServer(app, PORT);
