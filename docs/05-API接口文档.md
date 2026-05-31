# API 接口文档

> 更新时间: 2026 年 5 月 17 日

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

## 2. ETF 相关接口

### 2.1 获取 ETF 列表

```
GET /api/etf/list
```

**响应示例**：

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "510300",
      "name": "沪深300ETF",
      "asset_type": "股票",
      "current_price": 3.8500,
      "change_pct": 0.52,
      "initial_ratio": 40.0000,
      "history_start": "2012-05-28",
      "history_end": "2026-05-16"
    }
  ]
}
```

### 2.2 添加 ETF

```
POST /api/etf/create
```

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | string | 是 | ETF 代码 |
| name | string | 是 | ETF 名称 |
| assetType | string | 是 | 资产类型 |

**响应示例**：

```json
{
  "success": true,
  "message": "创建成功"
}
```

### 2.3 编辑 ETF

```
PUT /api/etf/update
```

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | string | 是 | ETF 代码 |
| name | string | 否 | ETF 名称 |
| assetType | string | 否 | 资产类型 |
| initialRatio | number | 否 | 初始配比(%) |

### 2.4 删除 ETF

```
DELETE /api/etf/delete/:code
```

**URL 参数**：

| 参数 | 类型 | 说明 |
| --- | --- |
| code | ETF 代码 |

### 2.5 同步指定 ETF 历史行情

```
POST /api/etf/sync-history
```

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | string | 是 | ETF 代码 |

### 2.6 同步所有 ETF 实时行情

```
POST /api/etf/sync-quotes
```

**说明**: 爬取所有 ETF 的实时价格和涨跌幅。

### 2.7 获取 ETF 历史 K 线

```
GET /api/etf/history
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | string | 是 | ETF 代码 |

---

## 3. 配置相关接口

### 3.1 获取初始比例

```
GET /api/config/initial-ratios
```

**响应示例**：

```json
{
  "success": true,
  "data": [
    { "etfCode": "510300", "ratio": 40.0 },
    { "etfCode": "513100", "ratio": 30.0 },
    { "etfCode": "511520", "ratio": 20.0 },
    { "etfCode": "518880", "ratio": 10.0 }
  ]
}
```

### 3.2 更新初始比例

```
PUT /api/config/initial-ratios
```

**请求体**：

```json
{
  "ratios": [
    { "etfCode": "510300", "ratio": 40.0 },
    { "etfCode": "513100", "ratio": 30.0 }
  ]
}
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| ratios | array | 是 | ETF 比例数组 |
| ratios[].etfCode | string | 是 | ETF 代码 |
| ratios[].ratio | number | 是 | 目标比例(%) |

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

**响应示例**：

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "levels": {
      "drawdown": [
        { "level_order": 1, "threshold": 5.0, "ratios": {"510300": 45.0, "513100": 35.0} },
        { "level_order": 2, "threshold": 10.0, "ratios": {"510300": 50.0, "513100": 40.0} },
        { "level_order": 3, "threshold": 15.0, "ratios": {"510300": 55.0, "513100": 45.0} }
      ],
      "rally": [
        { "level_order": 1, "threshold": 5.0, "ratios": {"510300": 45.0, "513100": 35.0} },
        { "level_order": 2, ": 2, " ","level_order": 2, "threshold": 8.0, "ratios": {"510300": 40.0, "513100": 30.0} }
      ],
      "reset_on_high": true
    }
  }
}
```

### 3.6 保存策略 A 配置

```
POST /api/config/strategy-a
```

**请求体**：与 GET 响应结构一致。

### 3.7 获取策略 B 配置

```
GET /api/config/strategy-b
```

### 3.8 保存策略 B 配置

```
POST /api/config/strategy-b
```

### 3.9 获取再平衡配置

```
GET /api/config/rebalance
```

**响应示例**：

```json
{
  "    "  ",},
  "success": true,
  "data": {
    "threshold": 1.5,
    "auto_rebalance": false
  }
}
```

### 3.10 保存再平衡配置

```
POST /api/config/rebalance
```

### 3.11 获取规则修改记录

```
GET /api/records/rule-changes
```

---

## 4. 回测相关接口

### 4.1 执行回测

```
POST /api/backtest/run
```

**请求体**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| startDate | string | 是 | 回测起始日期(YYYY-MM-DD) |
| endDate | string | 是 | 回测结束日期(YYYY-MM-DD) |
| initialCapital | number | 是 | 初始资金(元) |
| feeRate | number | 是 | 交易费率 |
| feeExemptFive | boolean | 是 | 是否免五 |
| etfs | array | 是 | ETF 列表 [{code, name}] |
| initialRatios | object | 是 | 初始仓位比例 |
| enableA | boolean | 是 | 启用策略 A |
| enableB | boolean | 是 | 启用策略 B |
| strategyPriority | string | 是 | 策略优先级("strategy_a"/"strategy_b") |
| rebalanceThreshold | number | 否 | 再平衡阈值(%) |
| rebalanceConfig | object | 否 | 再平衡配置 |

**响应示例**：

```json
{
  "success": true,
  "data": {
    "totalReturn": 85.32,
    "annualReturn": 12.45,
    "max    "maxDrawdown": -18.50,
    "annualVolatility": 15.20,
    "sharpeRatio": 0.82,
    "dailyValues": [
      { "date": "2020-01-02", "value": 1000000 },
      { "date": "2020-01-03", "value": 1002500 }
    ],
    "benchmarkValues": [
      { "date": "2020-01-02", "value": 1000000 },
      { "date": "2020-01-03", "value": 1001500 }
    ],
    "tradeRecords": [],
    "dailyLogs": []
  }
}
```

**说明**: `dailyValues` 和 `benchmarkValues` 在参数寻优时为空(防爆盘)。

### 4.2 参数寻优

```
POST /api/backtest/optimize
```

**请求体**: 与回测一致，系统自动遍历不同 `rebalanceThreshold` 参数。

**响应示例**：

```json
{
  "success": true,
  "data": [
    {
      "rebalanceThreshold": 1.5,
      "totalReturn": 85.32,
      "annualReturn": 12.45,
      "maxDrawdown": -18.50
    },
    {
      "rebalanceThreshold": 2.0,
      "totalReturn": 82.10,
      "annualReturn": 11.98,
      "maxDrawdown": -19.20
    }
  ]
}
```

### 4.3 获取历史回测结果

```
GET /api/backtest/results
```

**说明**: 返回历史所有回测和寻优结果的排行列表。