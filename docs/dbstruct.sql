/*
 Navicat Premium Dump SQL

 Source Server         : 本地
 Source Server Type    : MySQL
 Source Server Version : 80012 (8.0.12)
 Source Host           : localhost:3306
 Source Schema         : etf_strategy

 Target Server Type    : MySQL
 Target Server Version : 80012 (8.0.12)
 File Encoding         : 65001

 Date: 31/05/2026 11:14:46
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for backtest_results
-- ----------------------------
DROP TABLE IF EXISTS `backtest_results`;
CREATE TABLE `backtest_results`  (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '回测名称',
  `params` json NULL COMMENT '回测参数(JSON)',
  `total_return` decimal(12, 4) NULL DEFAULT NULL COMMENT '区间总收益率(%)',
  `annual_return` decimal(12, 4) NULL DEFAULT NULL COMMENT '年化收益率(%)',
  `max_drawdown` decimal(12, 4) NULL DEFAULT NULL COMMENT '最大回撤(%)',
  `annual_volatility` decimal(12, 4) NULL DEFAULT NULL COMMENT '年化波动率(%)',
  `sharpe_ratio` decimal(12, 4) NULL DEFAULT NULL COMMENT '夏普比率',
  `daily_detail` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT '每日详情(JSON)',
  `create_time` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_create_time`(`create_time` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2708 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '回测结果表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for etf_basic
-- ----------------------------
DROP TABLE IF EXISTS `etf_basic`;
CREATE TABLE `etf_basic`  (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT 'ETF代码',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT 'ETF名称',
  `asset_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '资产类型：股票类/债券类/红利类/商品类/黄金类',
  `current_price` decimal(12, 4) NULL DEFAULT 0.0000 COMMENT '当前价格',
  `change_pct` decimal(10, 4) NULL DEFAULT 0.0000 COMMENT '涨跌幅(%)',
  `update_time` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `initial_ratio` decimal(10, 4) NOT NULL DEFAULT 0.0000 COMMENT '初始配置占比(%)',
  `is_enabled` tinyint(4) NULL DEFAULT 1 COMMENT '是否启用(1启用,0禁用)',
  `step_ratio` decimal(5, 2) NULL DEFAULT 5.00 COMMENT '加减比步长(%)',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_code`(`code` ASC) USING BTREE,
  INDEX `idx_asset_type`(`asset_type` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = 'ETF基础信息表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for etf_history
-- ----------------------------
DROP TABLE IF EXISTS `etf_history`;
CREATE TABLE `etf_history`  (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `etf_code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT 'ETF代码',
  `trade_date` date NOT NULL COMMENT '交易日期',
  `open_price` decimal(12, 4) NULL DEFAULT 0.0000 COMMENT '开盘价',
  `close_price` decimal(12, 4) NOT NULL COMMENT '收盘价',
  `high_price` decimal(12, 4) NULL DEFAULT 0.0000 COMMENT '最高价',
  `low_price` decimal(12, 4) NULL DEFAULT 0.0000 COMMENT '最低价',
  `volume` bigint(20) NULL DEFAULT 0 COMMENT '成交量(手)',
  `change_pct` decimal(10, 4) NULL DEFAULT 0.0000 COMMENT '涨跌幅(%)',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_etf_date`(`etf_code` ASC, `trade_date` ASC) USING BTREE,
  INDEX `idx_trade_date`(`trade_date` ASC) USING BTREE,
  INDEX `idx_etf_code`(`etf_code` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 13740 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = 'ETF历史行情数据表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for strategy_a_config
-- ----------------------------
DROP TABLE IF EXISTS `strategy_a_config`;
CREATE TABLE `strategy_a_config`  (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `trigger_type` enum('drawdown','rally') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '触发类型：drawdown回撤加仓/rally反弹减仓',
  `level_order` int(11) NOT NULL COMMENT '档位顺序(从低到高)',
  `threshold` decimal(10, 4) NOT NULL COMMENT '触发阈值(%)',
  `update_time` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `ratios` json NULL COMMENT '当前档位各资产目标占比 JSON, 格式: {\"510300\": 40, \"161119\": 60}',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_type_level`(`trigger_type` ASC, `level_order` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 96 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '策略A档位配置表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for strategy_b_config
-- ----------------------------
DROP TABLE IF EXISTS `strategy_b_config`;
CREATE TABLE `strategy_b_config`  (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `deviation_type` enum('overvalued','undervalued') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '偏离类型：overvalued高估/undervalued低估',
  `level_order` int(11) NOT NULL COMMENT '档位顺序(从低到高)',
  `threshold` decimal(10, 4) NOT NULL COMMENT '偏离阈值(%)',
  `update_time` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `ratios` json NULL COMMENT '当前档位各资产目标占比 JSON, 格式: {\"510300\": 30, \"161119\": 70}',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_type_level`(`deviation_type` ASC, `level_order` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '策略B档位配置表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for trade_records
-- ----------------------------
DROP TABLE IF EXISTS `trade_records`;
CREATE TABLE `trade_records`  (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `trade_time` datetime NOT NULL COMMENT '调仓时间',
  `trade_type` enum('rebalance','strategy_a','strategy_b','manual') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '调仓类型',
  `etf_code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT 'ETF代码',
  `trade_direction` enum('buy','sell') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '买卖方向',
  `shares` decimal(16, 2) NOT NULL COMMENT '买卖份额',
  `price` decimal(12, 4) NOT NULL COMMENT '成交价格',
  `amount` decimal(16, 2) NOT NULL COMMENT '成交金额',
  `fee` decimal(12, 2) NULL DEFAULT 0.00 COMMENT '手续费',
  `before_ratio` decimal(10, 4) NULL DEFAULT NULL COMMENT '调仓前占比(%)',
  `after_ratio` decimal(10, 4) NULL DEFAULT NULL COMMENT '调仓后占比(%)',
  `reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '调仓原因',
  `trigger_detail` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT '触发详情(JSON)',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_trade_time`(`trade_time` ASC) USING BTREE,
  INDEX `idx_trade_type`(`trade_type` ASC) USING BTREE,
  INDEX `idx_etf_code`(`etf_code` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 10698 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '调仓记录表' ROW_FORMAT = Dynamic;

SET FOREIGN_KEY_CHECKS = 1;
