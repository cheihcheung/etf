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
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { configApi, etfApi } from '../api'
import { ElMessage } from 'element-plus'
import type { StrategyAConfig, StrategyBConfig, StrategyLevel, RebalanceConfig } from '../types'
import { formatDateTime, getTodayString } from '@/utils'

const etfList = ref<any[]>([])
const initialRatiosMap = ref<Record<string, number>>({})
const stepRatiosMap = ref<Record<string, number>>({})
const savingA = ref(false)
const savingB = ref(false)

const strategyA = reactive<StrategyAConfig>({
	enabled: true,
	resetOnHigh: true,
	drawdownLevels: [],
	rallyLevels: [],
})

const strategyB = reactive<StrategyBConfig>({
	enabled: true,
	centralAnnual: 9.0,
	overvaluedLevels: [],
	undervaluedLevels: [],
})

const getLevelRatio = (ratios: any[], etfCode: string) => {
	const found = ratios.find((r) => r.etfCode === etfCode)
	return found ? found.targetRatio : 0
}

const setLevelRatio = (ratios: any[], etfCode: string, value: number) => {
	const found = ratios.find((r) => r.etfCode === etfCode)
	if (found) {
		found.targetRatio = value
	} else {
		ratios.push({ etfCode, targetRatio: value })
	}
}

const calcLevelSum = (ratios: any[]) => {
	const offsetSum = ratios.reduce((sum, r) => {
		const step = stepRatiosMap.value[r.etfCode] || 5.0
		const multiplier = parseFloat(r.targetRatio || 0)
		return sum + (multiplier * step)
	}, 0)
	return 100 + offsetSum
}

const calcLevelOffsetSum = (ratios: any[]) => {
	return ratios.reduce((sum, r) => {
		const step = stepRatiosMap.value[r.etfCode] || 5.0
		const multiplier = parseFloat(r.targetRatio || 0)
		return sum + (multiplier * step)
	}, 0)
}

const addLevel = (type: 'drawdown') => {
	const newLevel = {
		levelOrder: strategyA.drawdownLevels.length + 1,
		threshold: 5,
		ratios: etfList.value.map((e) => ({ etfCode: e.code, targetRatio: 0 })),
	}
	strategyA.drawdownLevels.push(newLevel as any)
}

const removeLevel = (type: 'drawdown', idx: number) => {
	strategyA.drawdownLevels.splice(idx, 1)
}

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

const removeBLevel = (type: 'overvalued' | 'undervalued', idx: number) => {
	if (type === 'overvalued') {
		strategyB.overvaluedLevels.splice(idx, 1)
	} else {
		strategyB.undervaluedLevels.splice(idx, 1)
	}
}

const loadAllConfig = async () => {
	try {
		const [etfRes, aRes, bRes, ratioRes] = await Promise.all([
			etfApi.list(),
			configApi.getStrategyA(),
			configApi.getStrategyB(),
			configApi.getInitialRatios()
		])

		const savedRatios = (ratioRes as any).data || []
		initialRatiosMap.value = {}
		stepRatiosMap.value = {}
		savedRatios.forEach((r: any) => {
			initialRatiosMap.value[r.etfCode] = parseFloat(r.ratio || 0)
			stepRatiosMap.value[r.etfCode] = parseFloat(r.stepRatio || 5.0)
		})

		// 极其关键的物理隐藏：仅仅保留状态为启用的 ETF 标的列！
		const rawEtfs = (etfRes as any).data || []
		etfList.value = rawEtfs.filter((item: any) => {
			const ratioItem = savedRatios.find((r: any) => r.etfCode === item.code)
			return ratioItem ? ratioItem.isEnabled !== false : true
		})

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
			strategyA.rallyLevels = []
		}

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
