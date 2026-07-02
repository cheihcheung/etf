# API 接口文档

> 更新时间: 2026 年 5 月 31 日

## 相关文档

- [项目概述](01-项目概述.md) - 了解项目整体架构
- [后端开发规范](03-后端开发规范.md) - 后端开发规范
- [数据库设计](04-数据库设计文档.md) - 数据库表结构

---

## 1. 通用规范

### 1.1 基础地址

```
开发环境: http://localhost:3001/api
前端代理(Vite): /api -> http://localhost:3001/api
```

### 1.2 HTTP 方法使用规范

| 操作类型 | HTTP 方法 | 说明 |
| --- | --- | --- |
| 列表查询 | GET | 查询数据列表 |
| 获取详情 | GET | 按标识获取单条数据 |
| 创建 | POST | 新建资源 |
| 更新 | PUT | 全量更新资源 |
| 删除 | DELETE | 删除资源 |
| 执行操作 | POST | 触发业务操作（回测、同步等） |
| 批量操作 | POST | 批量处理 |

**说明**:

- GET 请求参数通过 query string 传递
- POST/PUT 请求参数通过 request body（JSON）传递
- DELETE 请求的资源标识通过 URL 参数传递

### 1.3 参数命名规范

**原则**: 
- **请求参数**统一使用 camelCase（小驼峰），与前端代码风格保持一致。
- **响应字段**中直接映射数据库列的值可使用 snake_case，避免无谓的转换开销。

```typescript
// 请求体参数（camelCase）
{
  "assetType": "股票",      // 正确
  "initialRatio": 40.0,     // 正确
  // "asset_type": "股票",      // 禁止在请求中使用
  "initial_ratio": 40.0     // 禁止在请求中使用
}

// 响应体参数（GET 类接口可返回 snake_case）
// 响应中直接来自 DB 的字段可保持 snake_case
{
  "success": true,
  "data": [
    {
      "code": "510300",
      "asset_type": "股票",     // 允许：直接来自 DB
      "current_price": 3.8500  // 允许：直接来自 DB
    }
  ]
}
```

### 1.4 统一响应格式

```json
{
  "success": true,
  "data": {},
  "message": "操作成功"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| success | boolean | 请求是否成功 |
| data | any | 响应数据 |
| message | string | 消息提示 |

### 1.5 错误响应

```json
{
  "success": false,
  "message": "错误描述信息"
}
```

### 1.6 HTTP 状态码

| 状态码 | 说明 | 使用场景 |
| --- | --- | --- |
| 200 | 请求成功 | 正常返回数据或操作成功 |
| 400 | 参数错误 | 参数缺失、格式错误、业务校验失败 |
| 404 | 资源不存在 | 请求的资源未找到 |
| 500 | 服务器内部错误 | 后端代码异常 |

### 1.7 状态码与业务错误处理规范

- **200 + success: true**: 请求成功，前端正常处理 data
- **200 + success: false**: 业务逻辑错误（如查重），前端提示 message
- **400 + success: false**: 参数校验失败，前端提示 message
- **500 + success: false**: 服务器错误，前端提示"服务器内部错误"

---

## 2. 股票相关接口

### 2.1 获取股票列表

```
GET /api/etf/list
```

**响应说明**: 通过 `stock` JOIN `history_data` 聚合查询，自动附带历史 K 线起止日期范围。

**响应示例**：

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "510300",
      "name": "沪深300ETF",
      "asset_type": "股票类",
      "current_price": 3.8500,
      "change_pct": 0.52,
      "initial_ratio": 40.0000,
      "is_enabled": 1,
      "step_ratio": 5.00,
      "history_start": "2012-05-28",
      "history_end": "2026-05-16"
    }
  ]
}
```

### 2.2 添加股票

```
POST /api/etf/add
```

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | string | 是 | 股票代码 |
| name | string | 是 | 股票名称 |
| assetType | string | 是 | 资产类型（股票类/债券类/红利类/商品类/黄金类） |

**说明**: 添加成功后系统自动尝试拉取该股票的实时报价并写入 `current_price`、`change_pct`，初始配比默认为 `0.0000`。

**响应示例**：

```json
{
  "success": true,
  "message": "添加成功"
}
```

### 2.3 编辑股票

```
PUT /api/etf/update
```

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | string | 是 | 股票代码 |
| name | string | 否 | 股票名称 |
| assetType | string | 否 | 资产类型 |
| initialRatio | number | 否 | 初始配比(%) |

### 2.4 删除 ETF

```
DELETE /api/etf/delete/:code
```

**URL 参数**：

| 参数 | 类型 | 说明 |
| --- | --- |
| code | 股票代码 |

### 2.5 同步指定 ETF 历史行情

```
POST /api/etf/sync-history
```

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| startDate | string | 是 | 同步起始日期 (YYYY-MM-DD) |
| endDate | string | 是 | 同步结束日期 (YYYY-MM-DD) |
| codes | array | 否 | 指定 股票代码列表 (如 `["510300", "161119"]`)，不传或为空则同步全部 |

**响应示例**：
```json
{
  "success": true,
  "message": "历史数据同步完成，共1234条"
}
```

### 2.6 同步全量 ETF 实时行情

```
POST /api/etf/sync-all
```

**说明**: 一键爬取同步系统中当前配置的全部 ETF 最新实时价格与涨跌幅，并基于模型自动智能查漏补缺近期缺失的历史日 K 线明细数据。

**响应示例**：
```json
{
  "success": true,
  "message": "同步完成：3只股票实时价格已更新，自动补全了15条历史数据"
}
```

### 2.7 获取特定标的历史 K 线全序列

```
GET /api/etf/history/:code
```

**URL 参数**：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| code | string | ETF 交易代码 (如 510300) |

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| startDate | string | 是 | 行情起始日期 (YYYY-MM-DD) |
| endDate | string | 是 | 行情结束日期 (YYYY-MM-DD) |

**响应示例**：
```json
{
  "success": true,
  "source": "db",
  "data": [
    {
      "tradeDate": "2026-05-29",
      "openPrice": 3.8400,
      "closePrice": 3.8500,
      "highPrice": 3.8600,
      "lowPrice": 3.8300,
      "volume": 1250000,
      "changePct": 0.26
    }
  ]
}
```

### 2.8 快速获取并同步单只 ETF 实时报价

```
GET /api/etf/quote/:code
```

**URL 参数**：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| code | string | ETF 交易代码 |

**响应示例**：
```json
{
  "success": true,
  "data": {
    "currentPrice": 3.8500,
    "changePct": 0.52
  }
}
```

### 2.9 联机检索大盘标的代码

```
GET /api/etf/search
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| keyword | string | 是 | 搜索关键字（如名称、拼音首字母、交易代码） |

**响应示例**：
```json
{
  "success": true,
  "data": [
    { "code": "510300", "name": "沪深300ETF", "asset_type": "股票类" }
  ]
}
```

### 2.10 获取大盘全量 ETF 市场名录清单

```
GET /api/etf/market-list
```

**说明**: 用于系统拉取并展示在添加 ETF 时可以快速关联的市场标的名录备选。

---

## 3. 配置相关接口

### 3.1 获取初始比例

```
GET /api/config/initial-ratios
```

**说明**: 从 `stock` 表中读取，`isEnabled` 由 `is_enabled` 字段计算（NULL/undefined/非0均视为 true）；`stepRatio` 若数据库为 NULL 则默认返回 `5.0`。

**响应示例**：

```json
{
  "success": true,
  "data": [
    { "etfCode": "510300", "name": "沪深300ETF", "ratio": 40.0, "isEnabled": true, "stepRatio": 5.0 },
    { "etfCode": "510880", "name": "红利ETF",    "ratio": 20.0, "isEnabled": true, "stepRatio": 3.0 },
    { "etfCode": "161119", "name": "鹏华国债ETF","ratio": 40.0, "isEnabled": true, "stepRatio": 5.0 }
  ]
}
```

| 响应参数 | 类型 | 说明 |
| --- | --- | --- |
| data | array | 初始占比配置列表 |
| data[].etfCode | string | ETF 交易代码 |
| data[].name | string | 股票名称 |
| data[].ratio | number | 初始占比配置百分比(%)，当被禁用时该值为 0 |
| data[].isEnabled | boolean | 是否启用（禁用时物理剔除该标的并从策略配置中隐藏） |
| data[].stepRatio | number | 该标的专属的每档加减比/步长(%)，默认 5.0 |

### 3.2 更新初始比例

```
PUT /api/config/initial-ratios
```

**请求体**：

```json
{
  "ratios": [
    { "etfCode": "510300", "ratio": 40.0, "isEnabled": true, "stepRatio": 5.0 },
    { "etfCode": "510880", "ratio": 20.0, "isEnabled": true, "stepRatio": 3.0 },
    { "etfCode": "161119", "ratio": 40.0, "isEnabled": true, "stepRatio": 5.0 }
  ]
}
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| ratios | array | 是 | ETF 初始比与专属步长数组 |
| ratios[].etfCode | string | 是 | 股票代码 |
| ratios[].ratio | number | 是 | 初始比例(%)，如已禁用，传入 0 |
| ratios[].isEnabled | boolean | 是 | 是否启用 |
| ratios[].stepRatio | number | 是 | 该标的专属加减比步长(%)，默认 5.0 |

**校验规则**: 后端仅对 `isEnabled: true` 的标的进行总占比求和，总占比不能超过 100.01%。保存时先将所有占比重置为 0，再按传入值逐条更新。

### 3.3 获取全局配置

```
GET /api/config/global
```

**响应示例**：

```json
{
  "success": true,
  "data": {
    "annual_return_target": "8.0",
    "rebalance_threshold": "1.5",
    "fee_rate": "0.0003",
    "fee_exempt_five": "true"
  }
}
```

### 3.4 更新全局配置

```
PUT /api/config/global
```

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| annual_return_target | string | 否 | 年化目标(%) |
| rebalance_threshold | string | 否 | 再平衡阈值(%) |
| fee_rate | string | 否 | 交易费率(%) |
| fee_exempt_five | string | 否 | 是否免五("true"/"false") |

### 3.5 获取策略 A 配置

```
GET /api/config/strategy-a
```

**说明**: 从 `strategy_a_config` 表按 `level_order ASC` 排序读取，按 `trigger_type` 分为 `drawdownLevels`（回撤加仓）和 `rallyLevels`（反弹减仓）两组。`enabled` 和 `resetOnHigh` 目前在后端硬编码为 `true`，由回测时前端传入的 `resetOnHigh` 参数控制实际行为。

**响应示例**：

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "resetOnHigh": true,
    "drawdownLevels": [
      {
        "levelOrder": 1,
        "threshold": 5.0,
        "ratios": [
          { "etfCode": "161119", "targetRatio": 2 },
          { "etfCode": "510880", "targetRatio": -1 }
        ]
      },
      {
        "levelOrder": 2,
        "threshold": 10.0,
        "ratios": [
          { "etfCode": "161119", "targetRatio": 4 },
          { "etfCode": "510880", "targetRatio": -2 }
        ]
      }
    ],
    "rallyLevels": [
      {
        "levelOrder": 1,
        "threshold": 3.0,
        "ratios": [
          { "etfCode": "161119", "targetRatio": -1 },
          { "etfCode": "510880", "targetRatio": 1 }
        ]
      }
    ]
  }
}
```

| 响应参数 | 类型 | 说明 |
| --- | --- | --- |
| enabled | boolean | 是否启用该策略（固定 true，由后端硬编码返回） |
| resetOnHigh | boolean | 创新高时是否复位（固定 true，由后端硬编码返回；实际执行由回测参数 `resetOnHigh` 控制） |
| drawdownLevels | array | 回撤加仓分档列表（trigger_type = 'drawdown'） |
| rallyLevels | array | 反弹减仓分档列表（trigger_type = 'rally'） |
| [].levelOrder | number | 档位级别（1, 2, 3...） |
| [].threshold | number | 触发回撤/反弹阈值(%) |
| [].ratios | array | 资产偏离倍数配置（从 JSON 字段解析，键为 etfCode，值为整倍数乘数） |
| [].ratios[].etfCode | string | ETF 交易代码 |
| [].ratios[].targetRatio | number | **专属步长整倍数/乘数**，整数（如 `2`、`-1`），实际占比 = 初始占比 + `targetRatio × stepRatio`，每一档所有标的的偏离加权和必须为 0% |

### 3.6 保存策略 A 配置

```
PUT /api/config/strategy-a
```

**说明**: 使用数据库事务，先全量清空 `strategy_a_config` 表，再逐条插入新的档位数据。

**请求体**：

```json
{
  "drawdownLevels": [
    {
      "levelOrder": 1,
      "threshold": 5.0,
      "ratios": [
        { "etfCode": "161119", "targetRatio": 2 },
        { "etfCode": "510880", "targetRatio": -1 }
      ]
    }
  ],
  "rallyLevels": [
    {
      "levelOrder": 1,
      "threshold": 3.0,
      "ratios": [
        { "etfCode": "161119", "targetRatio": -1 },
        { "etfCode": "510880", "targetRatio": 1 }
      ]
    }
  ]
}
```

**响应示例**：

```json
{ "success": true, "message": "策略A配置保存成功" }
```

### 3.7 获取策略 B 配置

```
GET /api/config/strategy-b
```

**说明**: 从 `strategy_b_config` 表按 `level_order ASC` 读取，按 `deviation_type` 分为 `overvaluedLevels`（高估减仓）和 `undervaluedLevels`（低估加仓）两组。`centralAnnual` 固定返回 `10.0`，实际回测使用前端传入的 `centralAnnual` 参数。

**响应示例**：

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "centralAnnual": 10.0,
    "overvaluedLevels": [
      {
        "levelOrder": 1,
        "threshold": 3.0,
        "ratios": [
          { "etfCode": "161119", "targetRatio": -1 },
          { "etfCode": "510880", "targetRatio": 1 }
        ]
      }
    ],
    "undervaluedLevels": [
      {
        "levelOrder": 1,
        "threshold": 5.0,
        "ratios": [
          { "etfCode": "161119", "targetRatio": 2 },
          { "etfCode": "510880", "targetRatio": -2 }
        ]
      }
    ]
  }
}
```

### 3.8 保存策略 B 配置

```
PUT /api/config/strategy-b
```

**说明**: 使用数据库事务，先全量清空 `strategy_b_config` 表，再逐条插入新数据。

**请求体**：与 GET 响应的 `data` 结构一致（包含 `overvaluedLevels` 和 `undervaluedLevels` 两个数组）。

**响应示例**：

```json
{ "success": true, "message": "策略B配置保存成功" }
```

### 3.9 获取资产分类列表

```
GET /api/config/etf-types
```

**说明**: 返回系统内当前存在的 `asset_type` 去重列表，并与默认预设类型取并集。

**响应示例**：

```json
{
  "success": true,
  "data": ["股票类", "债券类", "红利类", "商品类", "黄金类"]
}
```

---

## 3.5 交易记录相关接口

### 3.5.1 获取交易流水（分页）

```
GET /api/records/trades
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| type | string | 否 | 交易类型筛选（init/rebalance/strategy_a/strategy_b） |
| startDate | string | 否 | 起始日期 (YYYY-MM-DD) |
| endDate | string | 否 | 结束日期 (YYYY-MM-DD)，结束时间自动补全为当日 23:59:59 |
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 50 |

**响应示例**：

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "trade_time": "2020-01-02",
      "trade_type": "init",
      "etf_code": "510300",
      "trade_direction": "buy",
      "shares": 1000,
      "price": 3.85,
      "amount": 3850.00,
      "fee": 0.12,
      "reason": "初始建仓"
    }
  ]
}
```

### 3.5.2 获取实盘市场估值

```
GET /api/records/market
```

**说明**: 拉取实时沪深300指数作为市场基准，当前持仓列表暂为空（实盘功能规划中）。

**响应示例**：

```json
{
  "success": true,
  "data": {
    "hs300": { "price": 3850.0, "changePct": 0.52 },
    "holdings": [],
    "totalValue": 0
  }
}
```

---

## 4. 回测相关接口

### 4.1 执行回测

```
POST /api/backtest/run
```

**请求体**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| startDate | string | 是 | - | 回测起始日期(YYYY-MM-DD) |
| endDate | string | 是 | - | 回测结束日期(YYYY-MM-DD) |
| initialCapital | number | 否 | 1000000 | 初始资金(元) |
| feeRate | number | 否 | 0.03 | 交易费率(%)，如 0.03 表示 0.03% |
| feeExemptFive | boolean | 否 | true | 是否免五（最低5元手续费豁免） |
| etfs | array | 是 | - | ETF 列表，格式 `[{code, name}]` |
| initialRatios | object | 是 | - | 初始仓位比例，格式 `{"510300": 40, "161119": 40, ...}` |
| strategyAConfig | object | 否 | null | 策略 A 配置（格式同 GET /api/config/strategy-a 响应），为 null 时不启用策略 A |
| strategyBConfig | object | 否 | null | 策略 B 配置（格式同 GET /api/config/strategy-b 响应），为 null 时不启用策略 B |
| rebalanceConfig | object | 否 | null | 再平衡配置对象，不为 null 时开启日常再平衡 |
| rebalanceThreshold | number | 否 | 1.5 | 再平衡触发阈值(%)，任意标的实际占比偏离目标超过此值即触发再平衡 |
| tradeFrequency | string | 否 | monthly | 调仓频率：daily（每日）/ weekly（每周五）/ monthly（每月末） |
| strategyPriority | string | 否 | strategy_a | 双策略同日触发时的优先级：strategy_a / strategy_b |
| centralAnnual | number | 否 | 10 | 策略 B 的年化收益率中枢值(%) |
| resetOnHigh | boolean | 否 | true | 策略 A：组合净值创历史新高时是否自动复位至初始配置 |

**响应示例**：

```json
{
  "success": true,
  "data": {
    "totalReturn": 85.3200,
    "annualReturn": 12.4500,
    "maxDrawdown": 18.5000,
    "annualVolatility": 15.2000,
    "sharpeRatio": 0.8200,
    "finalValue": 1853200.00,
    "totalTrades": 128,
    "benchmarkMetrics": {
      "totalReturn": 45.20,
      "annualReturn": 7.10,
      "maxDrawdown": 33.80,
      "annualVolatility": 22.10,
      "sharpeRatio": 0.21
    },
    "etfMetrics": {
      "510300": { "name": "沪深300ETF", "totalReturn": 45.2, "annualReturn": 7.1, "maxDrawdown": 33.8, "annualVolatility": 22.1, "sharpeRatio": 0.21 }
    },
    "dailyValues": [
      {
        "date": "2020-01-02",
        "totalValue": 1000000,
        "cash": 15000,
        "marketValue": 985000,
        "hs300Value": 1000000,
        "drawdown": 0,
        "assetRatios": { "cash": 1.5, "510300": 40.0, "161119": 40.0 },
        "etfPerformances": { "510300": 1000000 }
      }
    ],
    "tradeRecords": [
      {
        "date": "2020-01-02",
        "type": "init",
        "etfCode": "510300",
        "action": "buy",
        "shares": 10000,
        "price": 3.85,
        "amount": 38500,
        "fee": 0.12,
        "reason": "初始建仓",
        "totalValue": 1000000,
        "preRatio": 0,
        "postRatio": 3.85
      }
    ],
    "params": {}
  }
}
```

**说明**:
- `dailyValues` 最多返回所有交易日的数据；参数寻优模式（`isOptimization: true`）下，此字段为空以防数据库爆盘。
- `tradeRecords` 最多返回 2000 条；`trade_records` 表最多存储 500 条流水（仅在非寻优模式下写入）。
- 后端自动物理剔除 `is_enabled = 0` 的 ETF 及其对应 `initialRatios`，前端无需手动过滤。

### 4.2 参数寻优

```
POST /api/backtest/optimize
```

**说明**: 以笛卡尔积方式遍历 `optimizationRanges` 中每个参数的全量组合，并行执行多次回测（每次携带 `isOptimization: true` 标记，跳过大 JSON 存储）。遍历完成后按 `annualReturn` 降序、`maxDrawdown` 升序排序，返回前 50 名。

**请求体**：

```json
{
  "baseParams": {
    "startDate": "2020-01-01",
    "endDate": "2026-01-01",
    "initialCapital": 1000000,
    "feeRate": 0.03,
    "feeExemptFive": true,
    "etfs": [],
    "initialRatios": {},
    "strategyAConfig": {},
    "strategyBConfig": {},
    "rebalanceConfig": {}
  },
  "optimizationRanges": {
    "rebalanceThreshold": [1.0, 1.5, 2.0, 3.0],
    "centralAnnual": [8, 10, 12]
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| baseParams | object | 是 | 基础回测参数（除寻优变量外的固定参数，格式同 4.1 请求体） |
| optimizationRanges | object | 是 | 寻优参数范围，键为参数名，值为参数候选值数组；所有数组的笛卡尔积即为总组合数 |

**响应示例**：

```json
{
  "success": true,
  "data": {
    "totalCombinations": 12,
    "sortedResults": [
      {
        "params": { "rebalanceThreshold": 1.5, "centralAnnual": 10 },
        "totalReturn": 85.3200,
        "annualReturn": 12.4500,
        "maxDrawdown": 18.5000,
        "annualVolatility": 15.2000,
        "sharpeRatio": 0.8200
      }
    ],
    "bestParams": { "rebalanceThreshold": 1.5, "centralAnnual": 10 }
  }
}
```

### 4.3 获取历史回测结果列表

```
GET /api/backtest/results
```

**说明**: 返回 `backtest_results` 表中最近 500 条回测记录（含寻优），按 `create_time DESC` 排序，**不包含** `daily_detail` 大字段（节省带宽）。字段同时提供 `snake_case` 和 `camelCase` 两种格式。

**响应示例**：

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "回测_2020-01-01_2026-01-01",
      "params": "{...}",
      "total_return": 85.3200, "totalReturn": 85.3200,
      "annual_return": 12.4500, "annualReturn": 12.4500,
      "max_drawdown": 18.5000,  "maxDrawdown": 18.5000,
      "annual_volatility": 15.2000, "annualVolatility": 15.2000,
      "sharpe_ratio": 0.8200,   "sharpeRatio": 0.8200,
      "create_time": "2026-05-31T10:00:00", "createTime": "2026-05-31T10:00:00"
    }
  ]
}
```

### 4.4 获取单条回测结果详情

```
GET /api/backtest/results/:id
```

**URL 参数**：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| id | number | 回测结果 ID |

**说明**: 返回完整记录，包含 `daily_detail` 大字段（JSON 序列化字符串）。若指定 ID 不存在，返回 `404`。

**响应示例**：

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "回测_2020-01-01_2026-01-01",
    "params": "{...}",
    "total_return": 85.3200,
    "daily_detail": "{...}"
  }
}
```