<template>
	<div class="backtest">
		<el-card shadow="hover">
			<template #header>
				<span>回测参数设置</span>
			</template>
			<el-form :model="params" label-width="180px">
				<el-row :gutter="20">
					<el-col :span="8">
						<el-form-item label="起始日期">
							<el-date-picker v-model="params.startDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
						</el-form-item>
					</el-col>
					<el-col :span="8">
						<el-form-item label="结束日期">
							<el-date-picker v-model="params.endDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
						</el-form-item>
					</el-col>
					<el-col :span="8">
						<el-form-item label="初始资金">
							<el-input-number v-model="params.initialCapital" :min="10000" :step="50000" style="width: 100%" />
						</el-form-item>
					</el-col>
				</el-row>
				<el-row :gutter="20">
					<el-col :span="8">
						<el-form-item label="调仓频率">
							<el-select v-model="params.tradeFrequency" style="width: 100%">
								<el-option label="按日" value="daily" />
								<el-option label="按周" value="weekly" />
								<el-option label="按月" value="monthly" />
							</el-select>
						</el-form-item>
					</el-col>
					<el-col :span="8">
						<el-form-item>
							<template #label>
								<span>交易费率(%)</span>
							</template>
							<el-input-number v-model="params.feeRate" :min="0" :max="1" :step="0.001" :precision="3" style="width: 100%" />
						</el-form-item>
					</el-col>
					<el-col :span="8">
						<el-form-item label="免五规则">
							<el-switch v-model="params.feeExemptFive" />
						</el-form-item>
					</el-col>
				</el-row>
				<el-row :gutter="20">
					<el-col :span="8">
						<el-form-item label="再平衡阈值(%)">
							<el-input-number v-model="params.rebalanceThreshold" :min="0" :max="20" :step="0.1" :precision="1" style="width: 100%" />
						</el-form-item>
					</el-col>
					<el-col :span="8">
						<el-form-item label="策略优先级">
							<el-select v-model="params.strategyPriority" style="width: 100%">
								<el-option label="策略A优先" value="strategy_a" />
								<el-option label="策略B优先" value="strategy_b" />
							</el-select>
						</el-form-item>
					</el-col>
					<el-col :span="8">
						<el-form-item label="组合年化中枢(%)">
							<el-input-number v-model="params.centralAnnual" :min="1" :max="30" :step="0.5" :precision="1" style="width: 100%" />
						</el-form-item>
					</el-col>
				</el-row>
				<el-row :gutter="20">
					<el-col :span="8">
						<el-form-item label="创新高自动复位">
							<el-switch v-model="params.resetOnHigh" />
						</el-form-item>
					</el-col>
					<el-col :span="16">
						<el-form-item label="策略组合">
							<el-checkbox-group v-model="strategyToggles">
								<el-checkbox-button label="rebalance">再平衡</el-checkbox-button>
								<el-checkbox-button label="strategyA">策略A</el-checkbox-button>
								<el-checkbox-button label="strategyB">策略B</el-checkbox-button>
							</el-checkbox-group>
						</el-form-item>
					</el-col>
				</el-row>
			</el-form>
			<div style="text-align: right; margin-top: 12px">
				<el-button type="primary" @click="runBacktest" :loading="running" :icon="VideoPlay">单次回测</el-button>
				<el-button type="warning" @click="showOptimization" :icon="TrendCharts">参数寻优</el-button>
			</div>
		</el-card>

		<el-card v-if="result" shadow="hover" style="margin-top: 12px">
			<template #header>
				<div style="display: flex; justify-content: space-between; align-items: center">
					<span>回测结果</span>
					<el-tag>{{ params.startDate }} ~ {{ params.endDate }}</el-tag>
				</div>
			</template>
			<div class="result-comparison">
				<el-table :data="comparisonData" border stripe style="width: 100%">
					<el-table-column prop="label" label="核心指标" width="120" align="center" fixed />
					<el-table-column label="我的策略组合" align="center" min-width="120">
						<template #default="{ row }">
							<span :class="['result-cell', row.isBetter ? 'better' : '']">{{ row.value }}{{ row.unit }}</span>
						</template>
					</el-table-column>
					<el-table-column v-for="code in etfMetricCodes" :key="code" :label="result?.etfMetrics?.[code]?.name || code" align="center" min-width="120">
						<template #default="{ row }">
							<span class="result-cell etf-single">{{ row.etfs[code] }}{{ row.unit }}</span>
						</template>
					</el-table-column>
					<el-table-column label="沪深300 (基准)" align="center" min-width="120">
						<template #default="{ row }">
							<span class="result-cell benchmark">{{ row.benchmark }}{{ row.unit }}</span>
						</template>
					</el-table-column>
					<el-table-column label="策略超额/优化" align="center" min-width="120" fixed="right">
						<template #default="{ row }">
							<span :class="['result-cell', row.diff >= 0 ? 'plus' : 'minus']">{{ row.diff >= 0 ? '+' : '' }}{{ row.diff.toFixed(2) }}{{ row.unit }}</span>
						</template>
					</el-table-column>
				</el-table>
			</div>

			<el-divider />
			<el-tabs type="border-card" style="margin-top: 16px">
				<el-tab-pane label="收益对比曲线">
					<div style="height: 500px">
						<v-chart :option="chartOption" style="height: 100%" autoresize />
					</div>
				</el-tab-pane>
				<el-tab-pane label="资产配置变动">
					<div style="height: 400px">
						<v-chart :option="allocationChartOption" style="height: 100%" autoresize />
					</div>
				</el-tab-pane>
				<el-tab-pane label="回撤走势">
					<div style="height: 400px">
						<v-chart :option="drawdownChartOption" style="height: 100%" autoresize />
					</div>
				</el-tab-pane>
			</el-tabs>

			<el-divider v-if="result.tradeRecords?.length > 0" />
			<div v-if="result.tradeRecords?.length > 0">
				<div style="font-weight: 600; margin-bottom: 12px; color: #303133">调仓明细（共{{ result.tradeRecords.length }}笔交易）</div>
				<el-table :data="result.tradeRecords" stripe border max-height="400" :span-method="objectSpanMethod">
					<el-table-column label="日期" width="100" align="center">
						<template #default="{ row }">{{ row.date || '-' }}</template>
					</el-table-column>
					<el-table-column label="账户总额" width="130" align="center">
						<template #default="{ row }">
							<span style="font-weight: 600; color: #303133">
								¥{{
									Number(row.totalValue || row.total_value || 0).toLocaleString('zh-CN', {
										minimumFractionDigits: 2,
										maximumFractionDigits: 2
									})
								}}
							</span>
						</template>
					</el-table-column>
					<el-table-column label="类型" width="110" align="center">
						<template #default="{ row }">
							<el-tag :type="row.type === 'init' ? 'success' : row.type === 'rebalance' ? 'warning' : row.type === 'strategy_a' ? 'danger' : 'info'">{{ row.type === 'init' ? '初始建仓' : row.type === 'rebalance' ? '日常再平衡' : row.type === 'strategy_a' ? '策略A调仓' : row.type === 'strategy_b' ? '策略B调仓' : '策略调仓' }}</el-tag>
						</template>
					</el-table-column>
					<el-table-column prop="etfCode" label="ETF代码" width="80" align="center" />
					<el-table-column label="方向" width="70" align="center">
						<template #default="{ row }">
							<span :style="{ color: row.action === 'buy' ? '#f56c6c' : '#67c23a' }">{{ row.action === 'buy' ? '买入' : '卖出' }}</span>
						</template>
					</el-table-column>
					<el-table-column prop="shares" label="份额" width="80" align="center" />
					<el-table-column label="价格" width="80" align="center">
						<template #default="{ row }">{{ Number(row.price).toFixed(4) }}</template>
					</el-table-column>
					<el-table-column label="金额(元)" width="120" align="center">
						<template #default="{ row }">
							¥{{
								Number(row.amount).toLocaleString('zh-CN', {
									minimumFractionDigits: 2,
								})
							}}
						</template>
					</el-table-column>
					<el-table-column label="调仓前金额" width="120" align="center">
						<template #default="{ row }">¥{{ (row.preAmount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}</template>
					</el-table-column>
					<el-table-column label="调仓后金额" width="120" align="center">
						<template #default="{ row }">¥{{ (row.postAmount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}</template>
					</el-table-column>
					<el-table-column label="调仓前占比" width="100" align="center">
						<template #default="{ row }">{{ (row.preRatio || 0).toFixed(2) }}%</template>
					</el-table-column>
					<el-table-column label="调仓后占比" width="100" align="center">
						<template #default="{ row }">{{ (row.postRatio || 0).toFixed(2) }}%</template>
					</el-table-column>
					<el-table-column label="费用(元)" width="80" align="center">
						<template #default="{ row }">{{ Number(row.fee || 0).toFixed(2) }}</template>
					</el-table-column>
					<el-table-column prop="reason" label="原因" min-width="180" show-overflow-tooltip align="left" />
				</el-table>
			</div>
		</el-card>

		<el-card v-if="optimizationResult" shadow="hover" style="margin-top: 12px">
			<template #header>
				<span>参数寻优结果（共{{ optimizationResult.totalCombinations }}种组合）</span>
			</template>
			<el-alert v-if="optimizationResult.bestParams" title="最优参数" type="success" show-icon :description="bestParamsDesc" style="margin-bottom: 16px" closable />
			<el-table :data="optimizationResult.sortedResults" stripe border max-height="500">
				<el-table-column type="index" label="排名" width="60" align="center" />
				<el-table-column label="参数" min-width="200" align="left">
					<template #default="{ row }">
						<span style="font-size: 12px">{{ JSON.stringify(row.params) }}</span>
					</template>
				</el-table-column>
				<el-table-column label="年化" width="100" align="center" sortable prop="annualReturn">
					<template #default="{ row }">{{ row.annualReturn?.toFixed(2) }}%</template>
				</el-table-column>
				<el-table-column label="总收益" width="100" align="center" sortable prop="totalReturn">
					<template #default="{ row }">{{ row.totalReturn?.toFixed(2) }}%</template>
				</el-table-column>
				<el-table-column label="最大回撤" width="120" align="center" sortable prop="maxDrawdown">
					<template #default="{ row }">{{ row.maxDrawdown?.toFixed(2) }}%</template>
				</el-table-column>
				<el-table-column label="夏普" width="100" align="center" sortable prop="sharpeRatio">
					<template #default="{ row }">{{ row.sharpeRatio?.toFixed(4) }}</template>
				</el-table-column>
			</el-table>
		</el-card>

		<el-card shadow="hover" style="margin-top: 12px">
			<template #header>
				<div style="display: flex; justify-content: space-between; align-items: center">
					<span>历史回测记录</span>
					<span style="font-size: 12px; color: #909399;">仅展示最新500条精简记录</span>
				</div>
			</template>
			<el-table :data="pagedHistoryResults" stripe v-loading="loadingHistory">
				<el-table-column label="时间" width="170" align="center">
					<template #default="{ row }">{{ row.create_time ? row.create_time.replace('T', ' ').replace(/\.\d+Z/, '') : '-' }}</template>
				</el-table-column>
				<el-table-column prop="name" label="名称" min-width="160" align="left" />
				<el-table-column label="年化" width="100" align="center">
					<template #default="{ row }">{{ parseFloat(row.annual_return).toFixed(2) }}%</template>
				</el-table-column>
				<el-table-column label="总收益" width="100" align="center">
					<template #default="{ row }">{{ parseFloat(row.total_return).toFixed(2) }}%</template>
				</el-table-column>
				<el-table-column label="最大回撤" width="100" align="center">
					<template #default="{ row }">{{ parseFloat(row.max_drawdown).toFixed(2) }}%</template>
				</el-table-column>
				<el-table-column label="夏普" width="100" align="center">
					<template #default="{ row }">{{ parseFloat(row.sharpe_ratio).toFixed(4) }}</template>
				</el-table-column>
				<el-table-column label="操作" width="100" align="center">
					<template #default="{ row }">
						<el-button text @click="viewHistoryDetail(row)">查看</el-button>
					</template>
				</el-table-column>
			</el-table>
			<div style="display: flex; justify-content: flex-end; margin-top: 16px">
				<el-pagination
					v-model:current-page="currentPage"
					v-model:page-size="pageSize"
					:page-sizes="[10, 20, 50, 100]"
					layout="total, sizes, prev, pager, next, jumper"
					:total="historyResults.length"
					background
				/>
			</div>
		</el-card>

		<el-dialog v-model="optimizeDialogVisible" title="参数寻优设置" width="600px">
			<el-form label-width="160px">
				<el-form-item label="再平衡阈值遍历">
					<el-select v-model="optimizeRanges.rebalanceThreshold" multiple placeholder="选择遍历值" style="width: 100%">
						<el-option v-for="v in 20" :key="v" :label="v + '%'" :value="v" />
					</el-select>
				</el-form-item>
				<el-form-item label="策略A回撤阈值">
					<el-select v-model="optimizeRates" multiple placeholder="暂不支持自动遍历">
						<el-option label="默认" value="default" />
					</el-select>
				</el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="optimizeDialogVisible = false">取消</el-button>
				<el-button type="warning" @click="runOptimization" :loading="optimizing">开始寻优</el-button>
			</template>
		</el-dialog>
	</div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { VideoPlay, TrendCharts, InfoFilled } from '@element-plus/icons-vue'
import { backtestApi, etfApi, configApi } from '../api'
import { ElMessage } from 'element-plus'
import type { BacktestParams, BacktestResult } from '../types'
import { getTodayString } from '@/utils'

use([LineChart, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, MarkLineComponent, CanvasRenderer])

const running = ref(false)
const optimizing = ref(false)
const loadingHistory = ref(false)
const optimizeDialogVisible = ref(false)

const result = ref<BacktestResult | null>(null)
const optimizationResult = ref<any>(null)
const historyResults = ref<any[]>([])

const currentPage = ref(1)
const pageSize = ref(10)

const pagedHistoryResults = computed(() => {
	const start = (currentPage.value - 1) * pageSize.value
	const end = start + pageSize.value
	return historyResults.value.slice(start, end)
})

const params = reactive<BacktestParams>({
	startDate: '2013-02-01',
	endDate: getTodayString(),
	initialCapital: 1000000,
	feeRate: 0.012,
	feeExemptFive: true,
	etfs: [],
	initialRatios: {},
	strategyAConfig: null,
	strategyBConfig: null,
	rebalanceThreshold: 2,
	tradeFrequency: 'daily',
	strategyPriority: 'strategy_a',
	centralAnnual: 10,
	resetOnHigh: true,
})

const strategyToggles = ref(['rebalance', '', ''])
const enableStrategyA = computed(() => strategyToggles.value.includes('strategyA'))
const enableStrategyB = computed(() => strategyToggles.value.includes('strategyB'))
const enableRebalance = computed(() => strategyToggles.value.includes('rebalance'))

const optimizeRanges = reactive({ rebalanceThreshold: [1.0, 1.5, 2.0] })
const optimizeRates = ref(['default'])

const bestParamsDesc = computed(() => {
	if (!optimizationResult.value?.bestParams) return ''
	const bp = optimizationResult.value.bestParams
	return `年化: ${bp.annualReturn?.toFixed(2)}%, 最大回撤: ${bp.maxDrawdown?.toFixed(2)}%, 夏普: ${bp.sharpeRatio?.toFixed(4)}`
})

const etfMetricCodes = computed(() => {
	return Object.keys(result.value?.etfMetrics || {})
})

const comparisonData = computed(() => {
	if (!result.value) return []
	const r = result.value
	const b = r.benchmarkMetrics || {
		totalReturn: 0,
		annualReturn: 0,
		maxDrawdown: 0,
		annualVolatility: 0,
		sharpeRatio: 0,
	}
	const m = r.etfMetrics || {}

	return [
		{
			label: '区间总收益',
			value: r.totalReturn.toFixed(2),
			benchmark: b.totalReturn.toFixed(2),
			etfs: Object.keys(m).reduce((acc, code) => ({ ...acc, [code]: m[code].totalReturn.toFixed(2) }), {} as any),
			unit: '%',
			isBetter: r.totalReturn > b.totalReturn,
			diff: r.totalReturn - b.totalReturn,
		},
		{
			label: '年化收益率',
			value: r.annualReturn.toFixed(2),
			benchmark: b.annualReturn.toFixed(2),
			etfs: Object.keys(m).reduce((acc, code) => ({ ...acc, [code]: m[code].annualReturn.toFixed(2) }), {} as any),
			unit: '%',
			isBetter: r.annualReturn > b.annualReturn,
			diff: r.annualReturn - b.annualReturn,
		},
		{
			label: '最大回撤',
			value: r.maxDrawdown.toFixed(2),
			benchmark: b.maxDrawdown.toFixed(2),
			etfs: Object.keys(m).reduce((acc, code) => ({ ...acc, [code]: m[code].maxDrawdown.toFixed(2) }), {} as any),
			unit: '%',
			isBetter: r.maxDrawdown < b.maxDrawdown,
			diff: b.maxDrawdown - r.maxDrawdown,
		},
		{
			label: '年化波动率',
			value: r.annualVolatility.toFixed(2),
			benchmark: b.annualVolatility.toFixed(2),
			etfs: Object.keys(m).reduce((acc, code) => ({ ...acc, [code]: m[code].annualVolatility.toFixed(2) }), {} as any),
			unit: '%',
			isBetter: r.annualVolatility < b.annualVolatility,
			diff: b.annualVolatility - r.annualVolatility,
		},
		{
			label: '夏普比率',
			value: r.sharpeRatio.toFixed(4),
			benchmark: b.sharpeRatio.toFixed(4),
			etfs: Object.keys(m).reduce((acc, code) => ({ ...acc, [code]: m[code].sharpeRatio.toFixed(4) }), {} as any),
			unit: '',
			isBetter: r.sharpeRatio > b.sharpeRatio,
			diff: r.sharpeRatio - b.sharpeRatio,
		},
	]
})

const chartOption = computed(() => {
	if (!result.value?.dailyValues) return {}
	const values = result.value.dailyValues
	const etfCodes = Object.keys(values[0]?.etfPerformances || {})

	const series = [
		{
			name: '组合净值',
			type: 'line',
			data: values.map((v) => v.totalValue),
			smooth: true,
			showSymbol: false,
			sampling: 'lttb',
			itemStyle: { color: '#f56c6c' },
			lineStyle: { width: 2 },
			z: 10,
		},
		{
			name: '沪深300',
			type: 'line',
			data: values.map((v) => v.hs300Value),
			smooth: true,
			showSymbol: false,
			sampling: 'lttb',
			lineStyle: { width: 2 }, // 调大线宽，保持一致
			itemStyle: { color: '#909399' },
		},
	]

	etfCodes.forEach((code) => {
		const etfLabel = result.value?.etfMetrics?.[code]?.name || code
		series.push({
			name: etfLabel,
			type: 'line',
			data: values.map((v) => (v.etfPerformances as any)?.[code] || 0),
			smooth: true,
			showSymbol: false,
			sampling: 'lttb',
			lineStyle: { width: 2 },
			itemStyle: { opacity: 0.5 } as any,
			selected: false,
		} as any)
	})

	return {
		tooltip: {
			trigger: 'axis',
			axisPointer: { type: 'cross' },
			backgroundColor: 'rgba(255, 255, 255, 0.9)',
			borderWidth: 1,
			borderColor: '#eee',
		},
		legend: {
			data: ['组合净值', '沪深300', ...etfCodes.map((c) => result.value?.etfMetrics?.[c]?.name || c)],
			selected: etfCodes.reduce((acc, c) => ({ ...acc, [result.value?.etfMetrics?.[c]?.name || c]: false }), {}),
			bottom: 10,
			type: 'scroll',
		},
		grid: { left: '3%', right: '4%', top: '5%', bottom: '15%', containLabel: true },
		xAxis: {
			type: 'category',
			data: values.map((v) => v.date),
			axisLabel: {
				fontSize: 10,
				interval: Math.ceil(values.length / 8),
			},
			boundaryGap: false,
		},
		yAxis: {
			type: 'value',
			scale: true,
			axisLabel: {
				formatter: (val: number) => (val / 10000).toFixed(1) + '万',
			},
		},
		series,
	}
})

const allocationChartOption = computed(() => {
	if (!result.value?.dailyValues || result.value.dailyValues.length === 0) return {}
	const values = result.value.dailyValues
	const etfCodes = Object.keys(values[0].assetRatios || {}).filter((k) => k !== 'cash')

	const series = [
		{
			name: '现金',
			type: 'line',
			stack: 'Total',
			areaStyle: {},
			emphasis: { focus: 'series' },
			data: values.map((v) => v.assetRatios?.cash?.toFixed(2) || 0),
		},
	]

	etfCodes.forEach((code) => {
		series.push({
			name: code,
			type: 'line',
			stack: 'Total',
			areaStyle: {},
			emphasis: { focus: 'series' },
			data: values.map((v) => v.assetRatios?.[code]?.toFixed(2) || 0),
		})
	})

	return {
		tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
		legend: { data: ['现金', ...etfCodes], bottom: 0 },
		grid: { left: '3%', right: '4%', top: '10%', bottom: '15%', containLabel: true },
		xAxis: {
			type: 'category',
			boundaryGap: false,
			data: values.map((v) => v.date),
			axisLabel: {
				fontSize: 10,
				interval: Math.ceil(values.length / 8),
			},
		},
		yAxis: { type: 'value', max: 100, name: '占比(%)' },
		series,
	}
})

const drawdownChartOption = computed(() => {
	if (!result.value?.dailyValues) return {}
	const values = result.value.dailyValues
	return {
		tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
		grid: { left: '3%', right: '4%', top: '10%', bottom: '15%', containLabel: true },
		xAxis: {
			type: 'category',
			data: values.map((v) => v.date),
			axisLabel: {
				fontSize: 10,
				interval: Math.ceil(values.length / 8),
			},
		},
		yAxis: { type: 'value', name: '回撤(%)', max: 0 },
		series: [
			{
				type: 'line',
				data: values.map((v) => v.drawdown?.toFixed(2) || 0),
				smooth: true,
				areaStyle: { color: 'rgba(245, 108, 108, 0.2)' },
				itemStyle: { color: '#f56c6c' },
			},
		],
	}
})

const formatMoney = (val: number) => {
	if (!val && val !== 0) return '¥0.00'
	return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const loadEtfList = async () => {
	try {
		const etfRes = await etfApi.list()
		const etfs = (etfRes as any).data || []
		params.etfs = etfs.map((e: any) => ({ code: e.code, name: e.name }))

		// 补回比例加载逻辑
		const ratioRes: any = await configApi.getInitialRatios()
		const ratios = ratioRes.data || []
		const ratioMap: Record<string, number> = {}
		ratios.forEach((r: any) => {
			ratioMap[r.etfCode] = parseFloat(r.ratio)
		})
		params.initialRatios = ratioMap
	} catch (e: any) {
		ElMessage.error('加载ETF及比例失败: ' + e.message)
	}
}

const runBacktest = async () => {
	running.value = true
	result.value = null
	try {
		// 动态获取最新配置并根据开关决定是否传入
		params.strategyAConfig = enableStrategyA.value ? (await configApi.getStrategyA()).data : null
		params.strategyBConfig = enableStrategyB.value ? (await configApi.getStrategyB()).data : null

		// 处理再平衡开关，不再读取数据库再平衡配置，直接用前端开关状态生成标识
		params.rebalanceConfig = enableRebalance.value ? { enabled: true } : null

		const res: any = await backtestApi.run(params)
		result.value = res.data
		ElMessage.success('回测完成')
		await loadHistory()
	} catch (e: any) {
		ElMessage.error('回测失败: ' + e.message)
	} finally {
		running.value = false
	}
}

const showOptimization = () => {
	optimizeDialogVisible.value = true
}

const runOptimization = async () => {
	optimizing.value = true
	optimizationResult.value = null
	try {
		const optimParams = {
			baseParams: { ...params },
			optimizationRanges: { ...optimizeRanges },
		}
		optimParams.baseParams.strategyAConfig = enableStrategyA.value ? (await configApi.getStrategyA()).data : null
		optimParams.baseParams.strategyBConfig = enableStrategyB.value ? (await configApi.getStrategyB()).data : null
		
		// 寻优时同样剥离数据库再平衡配置读取，直接依据开关状态赋标识
		optimParams.baseParams.rebalanceConfig = enableRebalance.value ? { enabled: true } : null
		const res: any = await backtestApi.optimize(optimParams)
		optimizationResult.value = res.data
		optimizeDialogVisible.value = false
		ElMessage.success(`参数寻优完成，共${res.data.totalCombinations}种组合`)
	} catch (e: any) {
		ElMessage.error('参数寻优失败: ' + e.message)
	} finally {
		optimizing.value = false
	}
}

const loadHistory = async () => {
	loadingHistory.value = true
	try {
		const res: any = await backtestApi.results()
		historyResults.value = res.data || []
		currentPage.value = 1 // 每次成功加载新数据自动复位到第一页
	} catch {
	} finally {
		loadingHistory.value = false
	}
}

const viewHistoryDetail = async (row: any) => {
	try {
		const res: any = await backtestApi.detail(row.id)
		if (res.data?.daily_detail) {
			const detail = typeof res.data.daily_detail === 'string' ? JSON.parse(res.data.daily_detail) : res.data.daily_detail
			result.value = detail
		}
	} catch (e: any) {
		ElMessage.error('加载详情失败: ' + e.message)
	}
}

// ==========================================
// 调仓流水表格行合并算法实现 (相同时刻日期与账户总资产跨行合并展示)
// ==========================================
const spanArr = ref<number[]>([])
let position = 0

watch(() => result.value?.tradeRecords, (newRecords) => {
	spanArr.value = []
	position = 0
	if (!newRecords || newRecords.length === 0) return

	for (let i = 0; i < newRecords.length; i++) {
		if (i === 0) {
			spanArr.value.push(1)
			position = 0
		} else {
			// 如果当前交易记录的日期与上一条完全一致，则累计行合并跨度并填入占位 0
			if (newRecords[i].date === newRecords[i - 1].date) {
				spanArr.value[position] += 1
				spanArr.value.push(0)
			} else {
				spanArr.value.push(1)
				position = i
			}
		}
	}
}, { immediate: true })

const objectSpanMethod = ({ rowIndex, columnIndex }: any) => {
	// 对“日期”(索引 0)和“账户总额”(索引 1)两列执行行合并
	if (columnIndex === 0 || columnIndex === 1) {
		const _row = spanArr.value[rowIndex]
		const _col = _row > 0 ? 1 : 0
		return {
			rowspan: _row,
			colspan: _col,
		}
	}
}

onMounted(async () => {
	await Promise.all([loadEtfList(), loadHistory()])
})
</script>

<style scoped>
.result-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 16px;
}

.result-item {
	text-align: center;
	padding: 16px;
	background: #f5f7fa;
	border-radius: 8px;
}

.result-label {
	font-size: 12px;
	color: #909399;
	margin-bottom: 8px;
}

.result-value {
	font-size: 22px;
	font-weight: bold;
}

.result-value.primary {
	color: #409eff;
}
.result-value.danger {
	color: #f56c6c;
}
.result-value.warning {
	color: #e6a23c;
}
.result-value.info {
	color: #67c23a;
}
</style>
