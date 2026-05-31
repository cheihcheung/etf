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

 Date: 30/05/2026 11:16:19
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

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
) ENGINE = InnoDB AUTO_INCREMENT = 47 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '策略A档位配置表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of strategy_a_config
-- ----------------------------
INSERT INTO `strategy_a_config` VALUES (37, 'drawdown', 1, 5.0000, '2026-05-30 11:10:23', '{\"161119\": 25, \"510300\": 50, \"510880\": 25}');
INSERT INTO `strategy_a_config` VALUES (38, 'drawdown', 2, 10.0000, '2026-05-30 11:10:23', '{\"161119\": 20, \"510300\": 60, \"510880\": 20}');
INSERT INTO `strategy_a_config` VALUES (39, 'drawdown', 3, 15.0000, '2026-05-30 11:10:23', '{\"161119\": 15, \"510300\": 70, \"510880\": 15}');
INSERT INTO `strategy_a_config` VALUES (40, 'drawdown', 4, 20.0000, '2026-05-30 11:10:23', '{\"161119\": 10, \"510300\": 80, \"510880\": 10}');
INSERT INTO `strategy_a_config` VALUES (41, 'drawdown', 5, 25.0000, '2026-05-30 11:10:23', '{\"161119\": 5, \"510300\": 90, \"510880\": 5}');
INSERT INTO `strategy_a_config` VALUES (42, 'rally', 1, 5.0000, '2026-05-30 11:10:23', '{\"161119\": 10, \"510300\": 90}');
INSERT INTO `strategy_a_config` VALUES (43, 'rally', 2, 10.0000, '2026-05-30 11:10:23', '{\"161119\": 20, \"510300\": 80}');
INSERT INTO `strategy_a_config` VALUES (44, 'rally', 3, 15.0000, '2026-05-30 11:10:23', '{\"161119\": 30, \"510300\": 70}');
INSERT INTO `strategy_a_config` VALUES (45, 'rally', 4, 20.0000, '2026-05-30 11:10:23', '{\"161119\": 40, \"510300\": 60}');
INSERT INTO `strategy_a_config` VALUES (46, 'rally', 5, 25.0000, '2026-05-30 11:10:23', '{\"161119\": 50, \"510300\": 50}');

SET FOREIGN_KEY_CHECKS = 1;
