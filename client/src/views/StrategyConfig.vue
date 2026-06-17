<template>
	<div class="strategy-config">
		<el-card shadow="hover">
			<template #header>
				<div style="display: flex; justify-content: space-between; align-items: center">
					<span>策略A：历史最高点回撤档位策略</span>
				</div>
			</template>

			<div style="margin-bottom: 16px">
				<div v-for="(level, idx) in strategyA.drawdownLevels" :key="'dd-' + idx" class="level-card">
					<div class="level-header">
						<span class="level-title">第{{ idx + 1 }}档</span>
						<el-button type="danger" text @click="removeLevel('drawdown', idx)">删除</el-button>
					</div>
					<el-row :gutter="20" style="flex-wrap: wrap">
						<el-col :span="8">
							<el-form-item label="回撤阈值(%)" label-width="180px">
								<el-input-number v-model="level.threshold" :min="0" :max="50" :step="1" :precision="1" style="width: 100%" />
							</el-form-item>
						</el-col>
						<el-col v-for="etf in etfList" :key="etf.code" :span="8">
							<el-form-item :label="`${etf.name}偏离`" label-width="180px">
								<el-input-number :model-value="getLevelRatio(level.ratios, etf.code)" @update:model-value="(val: any) => setLevelRatio(level.ratios, etf.code, val)" :min="-20" :max="20" :step="1" :precision="0" style="width: 100%" />
								<div class="ratio-hint-text">
									初始 ({{ initialRatiosMap[etf.code] || 0 }}%) + 
									( {{ getLevelRatio(level.ratios, etf.code) }}倍 × 步长 {{ stepRatiosMap[etf.code] || 5.0 }}% ) = 
									<span style="font-weight: bold; color: #409eff;">{{ ((initialRatiosMap[etf.code] || 0) + (getLevelRatio(level.ratios, etf.code) * (stepRatiosMap[etf.code] || 5.0))).toFixed(1) }}%</span>
								</div>
							</el-form-item>
						</el-col>
						<el-col :span="8">
							<el-form-item label="实际总占比" label-width="180px">
								<div style="display: flex; flex-direction: column; align-items: flex-start;">
									<span
										:style="{
											color: Math.abs(calcLevelOffsetSum(level.ratios)) < 0.01 ? '#67c23a' : '#f56c6c',
											fontWeight: 'bold',
										}"
									>
										{{ calcLevelSum(level.ratios).toFixed(2) }}%
									</span>
									<span v-if="Math.abs(calcLevelOffsetSum(level.ratios)) >= 0.01" style="font-size: 12px; color: #f56c6c; line-height: 1.2; margin-top: 4px;">
										请使各偏离值总和为 0%
									</span>
									<span v-else style="font-size: 12px; color: #67c23a; line-height: 1.2; margin-top: 4px;">
										偏离已完美配平！
									</span>
								</div>
							</el-form-item>
						</el-col>
					</el-row>
				</div>
				<el-button type="primary" @click="addLevel('drawdown')" :icon="Plus" plain>添加回撤档位</el-button>
			</div>

			<div style="text-align: right; margin-top: 16px">
				<el-button type="primary" @click="saveStrategyA" :loading="savingA">保存策略A配置</el-button>
			</div>
		</el-card>

		<el-card shadow="hover" style="margin-top: 12px">
			<template #header>
				<div style="display: flex; justify-content: space-between; align-items: center">
					<span>策略B：长期年化中枢偏离估值策略</span>
				</div>
			</template>

			<div>
				<el-divider content-position="left">高估档位（年化超出中枢）</el-divider>
				<div v-for="(level, idx) in strategyB.overvaluedLevels" :key="'ov-' + idx" class="level-card">
					<div class="level-header">
						<span class="level-title">高估第{{ idx + 1 }}档</span>
						<el-button type="danger" text @click="removeBLevel('overvalued', idx)">删除</el-button>
					</div>
					<el-row :gutter="20" style="flex-wrap: wrap">
						<el-col :span="8">
							<el-form-item label="偏离阈值(%)" label-width="180px">
								<el-input-number v-model="level.threshold" :min="0.5" :max="20" :step="0.5" :precision="1" style="width: 100%" />
							</el-form-item>
						</el-col>
						<el-col v-for="etf in etfList" :key="etf.code" :span="8">
							<el-form-item :label="`${etf.name}偏离`" label-width="180px">
								<el-input-number :model-value="getLevelRatio(level.ratios, etf.code)" @update:model-value="(val: any) => setLevelRatio(level.ratios, etf.code, val)" :min="-20" :max="20" :step="1" :precision="0" style="width: 100%" />
								<div class="ratio-hint-text">
									初始 ({{ initialRatiosMap[etf.code] || 0 }}%) + 
									( {{ getLevelRatio(level.ratios, etf.code) }}倍 × 步长 {{ stepRatiosMap[etf.code] || 5.0 }}% ) = 
									<span style="font-weight: bold; color: #409eff;">{{ ((initialRatiosMap[etf.code] || 0) + (getLevelRatio(level.ratios, etf.code) * (stepRatiosMap[etf.code] || 5.0))).toFixed(1) }}%</span>
								</div>
							</el-form-item>
						</el-col>
						<el-col :span="8">
							<el-form-item label="实际总占比" label-width="180px">
								<div style="display: flex; flex-direction: column; align-items: flex-start;">
									<span
										:style="{
											color: Math.abs(calcLevelOffsetSum(level.ratios)) < 0.01 ? '#67c23a' : '#f56c6c',
											fontWeight: 'bold',
										}"
									>
										{{ calcLevelSum(level.ratios).toFixed(2) }}%
									</span>
									<span v-if="Math.abs(calcLevelOffsetSum(level.ratios)) >= 0.01" style="font-size: 12px; color: #f56c6c; line-height: 1.2; margin-top: 4px;">
										请使各偏离值总和为 0%
									</span>
									<span v-else style="font-size: 12px; color: #67c23a; line-height: 1.2; margin-top: 4px;">
										偏离已完美配平！
									</span>
								</div>
							</el-form-item>
						</el-col>
					</el-row>
				</div>
				<el-button type="primary" @click="addBLevel('overvalued')" :icon="Plus" plain>添加高估档位</el-button>

				<el-divider content-position="left">低估档位（年化低于中枢）</el-divider>
				<div v-for="(level, idx) in strategyB.undervaluedLevels" :key="'uv-' + idx" class="level-card">
					<div class="level-header">
						<span class="level-title">低估第{{ idx + 1 }}档</span>
						<el-button type="danger" text @click="removeBLevel('undervalued', idx)">删除</el-button>
					</div>
					<el-row :gutter="20" style="flex-wrap: wrap">
						<el-col :span="8">
							<el-form-item label="偏离阈值(%)" label-width="180px">
								<el-input-number v-model="level.threshold" :min="0.5" :max="20" :step="0.5" :precision="1" style="width: 100%" />
							</el-form-item>
						</el-col>
						<el-col v-for="etf in etfList" :key="etf.code" :span="8">
							<el-form-item :label="`${etf.name}偏离`" label-width="180px">
								<el-input-number :model-value="getLevelRatio(level.ratios, etf.code)" @update:model-value="(val: any) => setLevelRatio(level.ratios, etf.code, val)" :min="-20" :max="20" :step="1" :precision="0" style="width: 100%" />
								<div class="ratio-hint-text">
									初始 ({{ initialRatiosMap[etf.code] || 0 }}%) + 
									( {{ getLevelRatio(level.ratios, etf.code) }}倍 × 步长 {{ stepRatiosMap[etf.code] || 5.0 }}% ) = 
									<span style="font-weight: bold; color: #409eff;">{{ ((initialRatiosMap[etf.code] || 0) + (getLevelRatio(level.ratios, etf.code) * (stepRatiosMap[etf.code] || 5.0))).toFixed(1) }}%</span>
								</div>
							</el-form-item>
						</el-col>
						<el-col :span="8">
							<el-form-item label="实际总占比" label-width="180px">
								<div style="display: flex; flex-direction: column; align-items: flex-start;">
									<span
										:style="{
											color: Math.abs(calcLevelOffsetSum(level.ratios)) < 0.01 ? '#67c23a' : '#f56c6c',
											fontWeight: 'bold',
										}"
									>
										{{ calcLevelSum(level.ratios).toFixed(2) }}%
									</span>
									<span v-if="Math.abs(calcLevelOffsetSum(level.ratios)) >= 0.01" style="font-size: 12px; color: #f56c6c; line-height: 1.2; margin-top: 4px;">
										请使各偏离值总和为 0%
									</span>
									<span v-else style="font-size: 12px; color: #67c23a; line-height: 1.2; margin-top: 4px;">
										偏离已完美配平！
									</span>
								</div>
							</el-form-item>
						</el-col>
					</el-row>
				</div>
				<el-button type="primary" @click="addBLevel('undervalued')" :icon="Plus" plain>添加低估档位</el-button>
			</div>

			<div style="text-align: right; margin-top: 16px">
				<el-button type="primary" @click="saveStrategyB" :loading="savingB">保存策略B配置</el-button>
			</div>
		</el-card>
	</div>
</template>

<script setup lang="ts">
/**
 * ============================================================================
 * 文件：StrategyConfig.vue — 策略A / 策略B 档位配置页面
 * ============================================================================
 *
 * 【页面功能】
 *   1. 策略A（历史最高点回撤档位策略）— 配置 drawdownLevels（回撤触发档位列表）
 *   2. 策略B（长期年化中枢偏离估值策略）— 配置 overvaluedLevels（高估档位）和 undervaluedLevels（低估档位）
 *
 * 【核心概念 — 倍数模型（Multiplier Model）】
 *   每个档位的 ratios 数组中存储的不是"实际配比百分比"，而是"倍数（multiplier）"。
 *   实际配比的计算公式为：
 *     actual_ratio = initialRatio + multiplier × stepRatio
 *   其中：
 *     initialRatio — 该 ETF 的初始配比（如 25%）
 *     multiplier   — 用户在本页面配置的"偏离"值（如 -1, 0, 2）
 *     stepRatio    — 该 ETF 的步长比例（如 5%），存储在 initialRatios 表的 step_ratio 字段
 *
 *   示例：某 ETF 初始 25%，stepRatio=5%，multiplier=-1
 *     → actual_ratio = 25 + (-1) × 5 = 20%
 *
 * 【配平约束（零和偏离）】
 *   同一档位内，所有 ETF 的 multiplier × stepRatio 之和必须等于 0。
 *   即 Σ(multiplier_i × stepRatio_i) = 0
 *   这保证：所有 ETF 的 actual_ratio 之和 = 100%（100 + offsetSum = 100）
 *   前端在保存前会验证此约束，不满足时弹出警告并阻止保存。
 *
 * 【数据流向】
 *   页面加载 → loadAllConfig() 并行获取 ETF 列表 + 策略A配置 + 策略B配置 + 初始比例
 *   保存 → PUT /api/config/strategy-a 或 /api/config/strategy-b
 *   → 后端 config 路由调用 formatRatios() 将倍数转为 DB 存储格式后存入 strategy_a_config 表
 */
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { configApi, etfApi } from '../api'
import { ElMessage } from 'element-plus'
import type { StrategyAConfig, StrategyBConfig, StrategyLevel, RebalanceConfig } from '../types'
import { formatDateTime, getTodayString } from '@/utils'

// ===================== 基础数据 =====================

/** 已启用的 ETF 列表（过滤掉 is_enabled=false 的 ETF） */
const etfList = ref<any[]>([])
/** 各 ETF 的初始配比映射 {etfCode: initialRatio}，例如 {'510300': 25} */
const initialRatiosMap = ref<Record<string, number>>({})
/** 各 ETF 的步长比例映射 {etfCode: stepRatio}，默认 5.0% */
const stepRatiosMap = ref<Record<string, number>>({})
/** 策略A 保存中状态 */
const savingA = ref(false)
/** 策略B 保存中状态 */
const savingB = ref(false)

// ===================== 策略配置对象 =====================

/**
 * 策略A 配置（回撤档位策略）
 *   drawdownLevels — 回撤触发档位数组，每档包含：
 *     levelOrder  — 档位序号
 *     threshold   — 回撤阈值（百分比），如 5 表示从最高点回撤 5% 时触发
 *     ratios      — 各 ETF 的偏离倍数数组 [{etfCode, targetRatio}, ...]
 *   rallyLevels   — 反弹档位（当前前端置空，暂未使用）
 *   resetOnHigh   — 创新高时是否自动复位回撤高水位
 */
const strategyA = reactive<StrategyAConfig>({
	enabled: true,
	resetOnHigh: true,
	drawdownLevels: [],
	rallyLevels: [],
})

/**
 * 策略B 配置（年化中枢偏离策略）
 *   centralAnnual      — 年化收益中枢参考值（百分比）
 *   overvaluedLevels   — 高估档位数组（年化收益超出中枢时触发减仓）
 *   undervaluedLevels  — 低估档位数组（年化收益低于中枢时触发加仓）
 *   每档结构与策略A类似：{levelOrder, threshold, ratios}
 */
const strategyB = reactive<StrategyBConfig>({
	enabled: true,
	centralAnnual: 9.0,
	overvaluedLevels: [],
	undervaluedLevels: [],
})

// ===================== 倍数读写工具函数 =====================

/**
 * 从档位的 ratios 数组中读取某个 ETF 的偏离倍数
 * @param ratios  档位的 ratios 数组 [{etfCode, targetRatio}, ...]
 * @param etfCode 要查询的 ETF 代码
 * @returns 该 ETF 的 targetRatio（倍数），如果未配置则返回 0
 */
const getLevelRatio = (ratios: any[], etfCode: string) => {
	const found = ratios.find((r) => r.etfCode === etfCode)
	return found ? found.targetRatio : 0
}

/**
 * 设置某个 ETF 在某档位中的偏离倍数
 * 如果该 ETF 已存在于 ratios 数组中则更新，否则新增一条记录
 * @param ratios   档位的 ratios 数组（会被原地修改）
 * @param etfCode  ETF 代码
 * @param value    要设置的倍数值（可为负数，表示减仓）
 */
const setLevelRatio = (ratios: any[], etfCode: string, value: number) => {
	const found = ratios.find((r) => r.etfCode === etfCode)
	if (found) {
		found.targetRatio = value
	} else {
		ratios.push({ etfCode, targetRatio: value })
	}
}

// ===================== 配比校验计算 =====================

/**
 * 计算某档位的实际总占比（百分比）
 * 公式：100 + Σ(multiplier_i × stepRatio_i)
 * 当偏离配平时（offsetSum=0），总占比恰好等于 100%
 *
 * @param ratios 档位的 ratios 数组
 * @returns 实际总占比，例如 100.00 表示完美配平
 */
const calcLevelSum = (ratios: any[]) => {
	const offsetSum = ratios.reduce((sum, r) => {
		const step = stepRatiosMap.value[r.etfCode] || 5.0
		const multiplier = parseFloat(r.targetRatio || 0)
		return sum + (multiplier * step)
	}, 0)
	return 100 + offsetSum
}

/**
 * 计算某档位的偏离值总和（不含基准 100%）
 * 公式：Σ(multiplier_i × stepRatio_i)
 * 当结果为 0 时表示配平，否则保存时应给出警告
 *
 * @param ratios 档位的 ratios 数组
 * @returns 偏离值总和（正数=总占比>100%，负数=总占比<100%）
 */
const calcLevelOffsetSum = (ratios: any[]) => {
	return ratios.reduce((sum, r) => {
		const step = stepRatiosMap.value[r.etfCode] || 5.0
		const multiplier = parseFloat(r.targetRatio || 0)
		return sum + (multiplier * step)
	}, 0)
}

// ===================== 档位增删操作 =====================

/**
 * 为策略A添加一个回撤档位
 * 默认阈值为 5%，所有 ETF 的偏离倍数初始为 0（即保持原始配比不变）
 */
const addLevel = (type: 'drawdown') => {
	const newLevel = {
		levelOrder: strategyA.drawdownLevels.length + 1,
		threshold: 5,
		ratios: etfList.value.map((e) => ({ etfCode: e.code, targetRatio: 0 })),
	}
	strategyA.drawdownLevels.push(newLevel as any)
}

/** 删除策略A的指定回撤档位 */
const removeLevel = (type: 'drawdown', idx: number) => {
	strategyA.drawdownLevels.splice(idx, 1)
}

/**
 * 为策略B添加一个高估或低估档位
 * 默认阈值为 1%，所有 ETF 的偏离倍数初始为 0
 */
const addBLevel = (type: 'overvalued' | 'undervalued') => {
	const newLevel = {
		levelOrder: type === 'overvalued' ? strategyB.overvaluedLevels.length + 1 : strategyB.undervaluedLevels.length + 1,
		threshold: 1,
		ratios: etfList.value.map((e) => ({ etfCode: e.code, targetRatio: 0 })),
	}
	if (type === 'overvalued') {
		strategyB.overvaluedLevels.push(newLevel as any)
	} else {
		strategyB.undervaluedLevels.push(newLevel as any)
	}
}

/** 删除策略B的指定高估或低估档位 */
const removeBLevel = (type: 'overvalued' | 'undervalued', idx: number) => {
	if (type === 'overvalued') {
		strategyB.overvaluedLevels.splice(idx, 1)
	} else {
		strategyB.undervaluedLevels.splice(idx, 1)
	}
}

// ===================== 数据加载 =====================

/**
 * 页面初始化时并行加载所有配置数据
 * 包括：ETF 列表、策略A 配置、策略B 配置、初始配比及步长
 *
 * 注意：ETF 列表会过滤掉 is_enabled=false 的标的（物理隐藏），
 * 这意味着被禁用的 ETF 不会出现在策略配置界面的列中。
 */
const loadAllConfig = async () => {
	try {
		const [etfRes, aRes, bRes, ratioRes] = await Promise.all([
			etfApi.list(),
			configApi.getStrategyA(),
			configApi.getStrategyB(),
			configApi.getInitialRatios()
		])

		// 构建 initialRatiosMap 和 stepRatiosMap
		const savedRatios = (ratioRes as any).data || []
		initialRatiosMap.value = {}
		stepRatiosMap.value = {}
		savedRatios.forEach((r: any) => {
			initialRatiosMap.value[r.etfCode] = parseFloat(r.ratio || 0)
			stepRatiosMap.value[r.etfCode] = parseFloat(r.stepRatio || 5.0)
		})

		// 过滤：仅保留 is_enabled !== false 的 ETF（被禁用的标的不显示在配置界面）
		const rawEtfs = (etfRes as any).data || []
		etfList.value = rawEtfs.filter((item: any) => {
			const ratioItem = savedRatios.find((r: any) => r.etfCode === item.code)
			return ratioItem ? ratioItem.isEnabled !== false : true
		})

		// 填充策略A配置
		const aData = (aRes as any).data
		if (aData) {
			strategyA.enabled = aData.enabled
			strategyA.resetOnHigh = aData.resetOnHigh
			strategyA.drawdownLevels = (aData.drawdownLevels || []).map((l: any) => ({
				...l,
				levelOrder: l.levelOrder,
				threshold: l.threshold,
				ratios: l.ratios || [],
			}))
			strategyA.rallyLevels = [] // 前端暂不使用反弹档位
		}

		// 填充策略B配置
		const bData = (bRes as any).data
		if (bData) {
			strategyB.enabled = bData.enabled
			strategyB.centralAnnual = bData.centralAnnual
			strategyB.overvaluedLevels = (bData.overvaluedLevels || []).map((l: any) => ({
				...l,
				levelOrder: l.levelOrder,
				threshold: l.threshold,
				ratios: l.ratios || [],
			}))
			strategyB.undervaluedLevels = (bData.undervaluedLevels || []).map((l: any) => ({
				...l,
				levelOrder: l.levelOrder,
				threshold: l.threshold,
				ratios: l.ratios || [],
			}))
		}
	} catch (e: any) {
		ElMessage.error('加载配置失败: ' + e.message)
	}
}

// ===================== 保存操作（含配平校验） =====================

/**
 * 保存策略A配置
 * 校验逻辑：遍历所有回撤档位，检查每档的偏离值总和是否为 0（即实际总占比 = 100%）。
 * 如果任一档位未配平，弹出警告并阻止保存。
 * 校验通过后调用 configApi.updateStrategyA() 提交到后端。
 */
const saveStrategyA = async () => {
	// 验证每一档偏离值总和是否都等于 0% (即实际总占比 100%)
	for (let i = 0; i < strategyA.drawdownLevels.length; i++) {
		const level = strategyA.drawdownLevels[i]
		const offsetSum = calcLevelOffsetSum(level.ratios)
		if (Math.abs(offsetSum) >= 0.01) {
			ElMessage.warning(`第 ${i + 1} 档的资产偏移量总和为 ${offsetSum.toFixed(1)}%（不等于 0%），请调整配平后再保存！`)
			return
		}
	}

	savingA.value = true
	try {
		await configApi.updateStrategyA({
			enabled: strategyA.enabled,
			resetOnHigh: strategyA.resetOnHigh,
			drawdownLevels: strategyA.drawdownLevels,
			rallyLevels: [],
		})
		ElMessage.success('策略A配置保存成功')
	} catch (e: any) {
		ElMessage.error('保存失败: ' + e.message)
	} finally {
		savingA.value = false
	}
}

/**
 * 保存策略B配置
 * 校验逻辑：与策略A相同，需分别校验高估档位和低估档位的配平约束。
 */
const saveStrategyB = async () => {
	// 验证高估每一档偏离值总和是否都等于 0%
	for (let i = 0; i < strategyB.overvaluedLevels.length; i++) {
		const level = strategyB.overvaluedLevels[i]
		const offsetSum = calcLevelOffsetSum(level.ratios)
		if (Math.abs(offsetSum) >= 0.01) {
			ElMessage.warning(`高估第 ${i + 1} 档的资产偏移量总和为 ${offsetSum.toFixed(1)}%（不等于 0%），请调整配平后再保存！`)
			return
		}
	}
	// 验证低估每一档偏离值总和是否都等于 0%
	for (let i = 0; i < strategyB.undervaluedLevels.length; i++) {
		const level = strategyB.undervaluedLevels[i]
		const offsetSum = calcLevelOffsetSum(level.ratios)
		if (Math.abs(offsetSum) >= 0.01) {
			ElMessage.warning(`低估第 ${i + 1} 档的资产偏移量总和为 ${offsetSum.toFixed(1)}%（不等于 0%），请调整配平后再保存！`)
			return
		}
	}

	savingB.value = true
	try {
		await configApi.updateStrategyB({
			enabled: strategyB.enabled,
			centralAnnual: strategyB.centralAnnual,
			overvaluedLevels: strategyB.overvaluedLevels,
			undervaluedLevels: strategyB.undervaluedLevels,
		})
		ElMessage.success('策略B配置保存成功')
	} catch (e: any) {
		ElMessage.error('保存失败: ' + e.message)
	} finally {
		savingB.value = false
	}
}

/** 页面挂载时加载所有配置 */
onMounted(() => {
	loadAllConfig()
})
</script>

<style>
.strategy-config .el-form-item__label {
	text-align: right !important;
	justify-content: flex-end !important;
}
.ratio-hint-text {
	font-size: 11px;
	color: #909399;
	margin-top: 4px;
	line-height: 1.2;
}
</style>

<style scoped>
.level-card {
	background: #fafafa;
	border: 1px solid #e4e7ed;
	border-radius: 8px;
	padding: 16px;
	margin-bottom: 12px;
}

.level-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 12px;
}

.level-title {
	font-weight: 600;
	color: #303133;
}
</style>
