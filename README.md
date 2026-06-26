# ETF 多资产动态配置策略系统

> 基于 ETF 量化回测与参数寻优平台。支持多资产动态配置、双策略并行执行、历史区间回测与三维参数寻优，全程可视化分析。提供 **web 网页版**（Express + MySQL，前后端分离）与 **desktop 桌面版**（Electron + SQLite，开箱即用）两套**完全独立**的实现，代码不共享。

## 技术栈

**web 前端** | Vue 3 + TypeScript + Vite 5 + Element Plus 2 + ECharts 5 + Vue Router 4
**web 后端** | Node.js + Express 4 + MySQL 8.0 + MySQL2 + Winston
**desktop** | Electron 42 + better-sqlite3（SQLite，免安装数据库）+ Vue 3 前端
**数据源** | 腾讯行情 API（实时 + 历史 K 线）+ 东方财富（搜索 + K 线）

## 快速开始

### desktop 桌面版（推荐，免数据库）

```bash
cd desktop
npm install
npm run dev
```

SQLite 数据库在 `desktop/data/` 自动创建，开箱即用。

### web 网页版（需 MySQL）

```bash
# 1. 初始化数据库
mysql -u root -p < docs/database/init_tables.sql

# 2. 启动后端
cd web/server
cp .env.demo .env   # 按需修改数据库连接信息
npm install
npm run dev          # 默认 3001 端口

# 3. 启动前端（另开终端）
cd web/client
npm install
npm run dev          # 默认 5173 端口，自动代理 /api 到 3001
```

### 打包桌面应用

```bash
cd desktop
npm run dist          # 产物在 desktop/dist/
```

## 项目结构

```
etf/
├── web/                       # web 网页版（BS 架构，完全独立）
│   ├── client/                # 前端 (Vue 3 + TS + Vite)，仅 HTTP 通信
│   │   └── src/
│   │       ├── api/           # API 接口层
│   │       ├── components/    # Layout 布局（网页侧边栏风格）
│   │       ├── router/        # 路由配置
│   │       ├── utils/         # electron-api.ts(纯 HTTP) + http.ts
│   │       └── views/         # 4 个核心页面
│   └── server/                # 后端 (Express + MySQL)
│       └── src/
│           ├── config/        # 数据库连接池配置
│           ├── models/        # 数据模型 (BaseModel ORM)
│           ├── routes/        # RESTful 路由
│           ├── services/      # 回测引擎 + 爬虫(spider.js)
│           └── utils/         # 日志、指标计算(helpers.js)
├── desktop/                   # desktop 桌面版（CS 架构，完全独立）
│   ├── client/                # 前端 (Vue 3 + TS + Vite)，仅 IPC 通信
│   │   └── src/
│   │       ├── components/    # Layout 布局（桌面标签页风格）
│   │       ├── router/        # 路由配置
│   │       ├── utils/         # electron-api.ts(纯 IPC)
│   │       └── views/         # 4 个核心页面
│   ├── models/                # SQLite 数据模型
│   ├── services/              # 回测引擎
│   ├── data/                  # SQLite 数据库（运行时生成）
│   ├── main.js                # Electron 主进程入口
│   ├── preload.js             # 预加载脚本
│   ├── database.js            # SQLite 封装
│   ├── ipc-handlers.js        # IPC 处理器
│   ├── spider.js              # 爬虫模块（desktop 独立版）
│   └── utils.js               # 量化指标计算（desktop 独立版）
├── docs/                      # 详细文档
│   └── database/              # 建表脚本
├── .gitignore
└── README.md
```

### 双架构设计（完全独立，代码不共享）

```
   ┌─────────────────────────┐         ┌─────────────────────────┐
   │       web/ (BS)         │         │     desktop/ (CS)       │
   │  Express + MySQL        │         │  Electron + SQLite      │
   │                         │         │                         │
   │  client/ ──HTTP──▶ server/        │  client/ ──IPC──▶ main.js
   │  (Vue3,纯HTTP)  (Express)         │  (Vue3,纯IPC)  (Electron)
   │                    │              │                   │     │
   │                    ▼              │                   ▼     │
   │              spider.js            │             spider.js   │
   │              helpers.js           │             utils.js    │
   │              (web 独立)           │             (desktop 独立)
   │                    │              │                   │     │
   │                    ▼              │                   ▼     │
   │                  MySQL            │                SQLite   │
   └─────────────────────────┘         └─────────────────────────┘
```

两套实现各自维护爬虫和量化指标计算代码，互不依赖。web 走 HTTP + MySQL，desktop 走 IPC + SQLite，前端布局风格也各自独立（web 侧边栏 / desktop 顶部标签页）。

## 核心功能

### 策略 A：回撤/反弹档位策略

下跌时分档加仓，反弹时跨级退档锁定高配收益。净值创历史新高（正收益）时一键填平复位。

### 策略 B：年化中枢偏离策略

计算滚动累计几何年化收益率，偏离长期收益中枢时高估防御下调、低估进攻收集。

### 决策融合引擎

双策略信号同日触发时，按配置的优先级合并执行，避免同一交易日多次调仓产生的摩擦损耗。

### 交易执行引擎

先卖后买、买入向下取整防透支、卖出向零取整防超卖、现金不足时自动折算限额买入。

### 内存沙盒回测

逐日推进，所有计算在内存中闭环运行，杜绝未来数据穿越。

### 三维参数寻优

遍历初始配比 + 策略 A/B 档位组合，自动计算夏普比率、卡玛比率，输出「性价比之王」「防暴跌之王」「绝对收益之王」三大推荐及 CSV 报表。

### 数据可视化

- 组合净值 vs 自定义基准收益双曲线（支持任意对比基准或无对比基准自适应）
- 回撤幅度走势图
- 多资产占比堆叠面积图
- 高阶调仓流水表（跨行合并展示）

## 系统架构

### MVC 三层（web 后端）

```
路由层 (routes/)  → 服务层 (services/)  → 模型层 (models/)
  HTTP 请求分发      核心算法与策略       BaseModel ORM
```

### desktop IPC 三层

```
渲染进程 (client/)  → IPC 通道 (preload)  → 主进程 (ipc-handlers.js)
  Vue 3 页面请求       contextBridge 桥接     调用模型/服务，操作 SQLite
```

### 数据库 6 张表

| 表名              | 说明               |
| ----------------- | ------------------ |
| stock             | ETF 标的与实时价格 |
| history_data      | 历史日 K 线行情    |
| trade_records     | 交易流水与调仓日志 |
| backtest_results  | 回测结果排行       |
| strategy_a_config | 策略 A 档位配置    |
| strategy_b_config | 策略 B 档位配置    |

> web 版用 MySQL（建表脚本见 `docs/database/init_tables.sql`），desktop 版用 SQLite（`database.js` 启动时自动建表）。

### 回测流程

```
启动回测 → 禁用资产自清洗 → 动态加载自定义对比基准 (无基准则为 null)
  → 读取行情 → 首日建仓
  → 逐日循环: 更新价格 → 延迟补仓
  → 策略 A/B 信号研判 → 决策融合
  → 日常再平衡 → 推进下一日
  → 循环结束 → 计算量化指标 → 存盘输出
```

### 技术特色

- **自研极简 ORM**（web）：基于 `BaseModel` 的 ThinkPHP 风格封装，参数绑定防 SQL 注入
- **SQLite 直连**（desktop）：`better-sqlite3` 同步 API，无需 ORM 层
- **防爆盘保护**：参数寻优模式下禁止写入大 JSON 字段
- **统一响应规范**：`{ success, data, message }` 格式

## 详细文档

| 文档                                    | 说明                             |
| --------------------------------------- | -------------------------------- |
| [项目概述](docs/01-项目概述.md)         | 整体介绍与技术架构               |
| [前端开发规范](docs/02-前端开发规范.md) | 前端技术栈与页面说明             |
| [后端开发规范](docs/03-后端开发规范.md) | 后端架构与 BaseModel ORM         |
| [数据库设计](docs/04-数据库设计文档.md) | 6 张表的详细设计                 |
| [API 接口文档](docs/05-API接口文档.md)  | 全部 RESTful 接口定义            |
| [策略算法文档](docs/06-策略算法文档.md) | 双策略原理与公式                 |
| [部署文档](docs/07-部署文档.md)         | 部署指南与常见问题               |
| [目录结构说明](docs/08-目录结构说明.md) | web/desktop 独立架构目录拆解     |
| [项目需求文档](docs/项目需求文档.md)    | 早期需求分析（含与实际差异说明） |

## 开发计划

- [x] 基础架构搭建
- [x] 核心回测引擎
- [x] 双策略算法
- [x] 参数寻优功能
- [x] Electron 桌面版（desktop 独立架构）
- [ ] 实盘模拟交易
- [ ] 多组合并行回测对比
- [ ] 自定义策略脚本
