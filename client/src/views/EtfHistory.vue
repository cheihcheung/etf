<template>
	<div class="etf-history">
		<el-card shadow="hover">
			<template #header>
				<div class="header-bar">
					<div class="header-left">
						<el-select v-model="selectedCode" @change="onEtfChange" style="width: 200px; margin-left: 16px" placeholder="选择ETF">
							<el-option v-for="etf in etfList" :key="etf.code" :label="etf.code + ' - ' + etf.name" :value="etf.code" />
						</el-select>
						<el-date-picker v-model="startDate" type="date" placeholder="开始日期" value-format="YYYY-MM-DD" style="width: 150px; margin-left: 16px" />
						<el-date-picker v-model="endDate" type="date" placeholder="结束日期" value-format="YYYY-MM-DD" style="width: 150px; margin-left: 8px" />
						<el-button type="primary" @click="loadData" :loading="loading" style="margin-left: 8px">查询</el-button>
						<el-button @click="showChart = !showChart" :type="showChart ? 'warning' : 'default'" style="margin-left: 8px">
							{{ showChart ? '隐藏图表' : '显示图表' }}
						</el-button>
					</div>
				</div>
			</template>

			<div v-show="showChart" style="height: 400px">
				<v-chart :option="chartOption" style="height: 100%; width: 100%" autoresize />
			</div>

			<div style="overflow-x: auto">
				<el-table :data="pagedData" stripe border height="500" style="margin-top: 12px" :default-sort="{ prop: 'tradeDate', order: 'descending' as const }">
					<el-table-column prop="tradeDate" label="日期" min-width="100" align="center" sortable />
					<el-table-column label="开盘价" min-width="90" align="center">
						<template #default="{ row }">
							{{ row.openPrice?.toFixed(4) }}
						</template>
					</el-table-column>
					<el-table-column label="收盘价" min-width="90" align="center">
						<template #default="{ row }">
							<span style="font-weight: 600">{{ row.closePrice?.toFixed(4) }}</span>
						</template>
					</el-table-column>
					<el-table-column label="最高价" min-width="90" align="center">
						<template #default="{ row }">
							<span style="color: #f56c6c">{{ row.highPrice?.toFixed(4) }}</span>
						</template>
					</el-table-column>
					<el-table-column label="最低价" min-width="90" align="center">
						<template #default="{ row }">
							<span style="color: #67c23a">{{ row.lowPrice?.toFixed(4) }}</span>
						</template>
					</el-table-column>
					<el-table-column label="涨跌幅" min-width="80" align="center" sortable>
						<template #default="{ row }">
							<span
								:style="{
									color: (row.changePct || 0) >= 0 ? '#f56c6c' : '#67c23a',
									fontWeight: 600,
								}"
							>
								{{ row.changePct >= 0 ? '+' : '' }}{{ row.changePct?.toFixed(2) }}%
							</span>
						</template>
					</el-table-column>
					<el-table-column label="成交量" min-width="100" align="center" sortable>
						<template #default="{ row }">
							{{ row.volume ? (row.volume / 10000).toFixed(0) + '万' : '-' }}
						</template>
					</el-table-column>
					<template #empty>
						<el-empty description="请选择ETF并点击查询" />
					</template>
				</el-table>
			</div>
			<div style="display: flex; justify-content: flex-end; margin-top: 12px">
				<el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="[20, 50, 100]" :total="historyData.length" layout="total, sizes, prev, pager, next, jumper" background />
			</div>
		</el-card>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { etfApi } from '../api'
import { ElMessage } from 'element-plus'
import { getTodayString } from '@/utils'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CandlestickChart, BarChart, LineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent, MarkLineComponent, MarkPointComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([CandlestickChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, MarkLineComponent, MarkPointComponent, DataZoomComponent, CanvasRenderer])

const route = useRoute()
const router = useRouter()

const etfList = ref<any[]>([])
const selectedCode = ref('')
const selectedName = ref('')
const startDate = ref('2010-01-01')
const endDate = ref(getTodayString())
const historyData = ref<any[]>([])
const loading = ref(false)
const showChart = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)

const pagedData = computed(() => {
	const desc = [...historyData.value].reverse()
	const start = (currentPage.value - 1) * pageSize.value
	return desc.slice(start, start + pageSize.value)
})

const loadEtfs = async () => {
	try {
		const res: any = await etfApi.list()
		etfList.value = res.data || []
		if (etfList.value.length > 0) {
			if (!selectedCode.value) {
				selectedCode.value = etfList.value[0].code
				selectedName.value = etfList.value[0].name
			}
			loadData()
		}
	} catch (e: any) {
		ElMessage.error('加载ETF列表失败: ' + e.message)
	}
}

const onEtfChange = (code: string) => {
	const etf = etfList.value.find((e) => e.code === code)
	selectedName.value = etf?.name || ''
	router.replace({ query: { code } })
	loadData()
}

const loadData = async () => {
	if (!selectedCode.value) {
		ElMessage.warning('请选择ETF')
		return
	}
	if (!startDate.value || !endDate.value) {
		ElMessage.warning('请选择起止日期')
		return
	}
	loading.value = true
	currentPage.value = 1
	try {
		const res: any = await etfApi.history(selectedCode.value, startDate.value, endDate.value)
		historyData.value = res.data || []
	} catch (e: any) {
		ElMessage.error('加载历史数据失败: ' + e.message)
	} finally {
		loading.value = false
	}
}

const annualReturn = computed(() => {
	const etf = etfList.value.find((e) => e.code === selectedCode.value)
	return etf ? parseFloat(etf.annual_return) || 0 : 0
})

const chartOption = computed(() => {
	const data = historyData.value
	if (!data || data.length === 0) return {}

	const dates = data.map((d: any) => d.tradeDate)
	// K线数据格式: [open, close, lowest, highest]
	// 增加兼容性判断，防止后端字段名变化导致数值一致
	const oclh = data.map((d: any) => {
		const open = d.open_price ?? d.openPrice ?? d.closePrice ?? d.close_price
		const close = d.closePrice ?? d.close_price
		const low = d.low_price ?? d.lowPrice ?? d.closePrice ?? d.close_price
		const high = d.high_price ?? d.highPrice ?? d.closePrice ?? d.close_price
		return [parseFloat(open), parseFloat(close), parseFloat(low), parseFloat(high)]
	})
	const volumes = data.map((d: any) => d.volume || 0)

	const firstDate = new Date(dates[0])
	const firstPrice = parseFloat(data[0].closePrice || data[0].close_price)
	const annualPct = annualReturn.value
	let benchmarkPrices: number[] | undefined

	if (annualPct > 0 && firstPrice > 0) {
		benchmarkPrices = dates.map((d: string) => {
			const years = (new Date(d).getTime() - firstDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
			return firstPrice * Math.pow(1 + annualPct / 100, years)
		})
	}

	const upColor = '#ef232a'
	const downColor = '#14b143'

	return {
		tooltip: {
			trigger: 'axis',
			axisPointer: { type: 'cross' },
			backgroundColor: 'rgba(255, 255, 255, 0.9)',
			formatter: (params: any) => {
				const dataIndex = params[0].dataIndex
				const row = data[dataIndex]
				const change = parseFloat(row.change_pct || row.changePct || 0)
				const changeColor = change >= 0 ? upColor : downColor

				let res = `<b>${params[0].name}</b>`
				params.forEach((item: any) => {
					if (item.seriesType === 'candlestick') {
						const d = item.data
						res += `<br/>开盘: <span style="color:${changeColor}">${d[1]}</span>`
						res += `<br/>收盘: <span style="color:${changeColor}">${d[2]}</span>`
						res += `<br/>最低: ${d[3]}`
						res += `<br/>最高: ${d[4]}`
						res += `<br/>涨跌幅: <span style="color:${changeColor}; font-weight:bold">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>`
					} else if (item.seriesType === 'bar') {
						res += `<br/>成交: ${(item.value / 10000).toFixed(2)} 万`
					} else if (typeof item.value === 'number') {
						res += `<br/>${item.seriesName}: ${item.value.toFixed(4)}`
					}
				})
				return res
			},
		},
		legend: {
			data: ['日K', '成交量', ...(benchmarkPrices ? [`年化${annualPct}%基准`] : [])],
			bottom: 10,
			itemWidth: 20,
			itemHeight: 10,
		},
		axisPointer: { link: [{ xAxisIndex: 'all' }] },
		grid: [
			{ left: 60, right: 30, height: '65%', top: 30 },
			{ left: 60, right: 30, top: '75%', height: '15%' },
		],
		xAxis: [
			{
				type: 'category',
				data: dates,
				boundaryGap: true,
				axisLine: { onZero: false },
				splitLine: { show: false },
				axisLabel: { fontSize: 10 },
				min: 'dataMin',
				max: 'dataMax',
				axisPointer: {
					show: true,
					label: { show: true },
				},
			},
			{
				type: 'category',
				gridIndex: 1,
				data: dates,
				boundaryGap: true,
				axisTick: { show: false },
				axisLabel: { show: false },
				// 核心修复：禁用第二个坐标轴的指示器标签
				axisPointer: {
					show: true,
					label: { show: false },
				},
			},
		],
		yAxis: [
			{
				type: 'value',
				scale: true,
				axisLabel: { fontSize: 10 },
			},
			{
				scale: true,
				gridIndex: 1,
				splitNumber: 2,
				axisLabel: { show: false },
				axisLine: { show: false },
				axisTick: { show: false },
				splitLine: { show: false },
			},
		],
		dataZoom: [
			{ type: 'inside', xAxisIndex: [0, 1], start: 90, end: 100 },
			{
				show: true,
				xAxisIndex: [0, 1],
				type: 'slider',
				top: '92%',
				start: 90,
				end: 100,
			},
		],
		series: [
			{
				name: '日K',
				type: 'candlestick',
				data: oclh,
				large: true,
				itemStyle: {
					color: upColor,
					color0: downColor,
					borderColor: upColor,
					borderColor0: downColor,
					borderWidth: 1,
				},
			},
			{
				name: '成交量',
				type: 'bar',
				xAxisIndex: 1,
				yAxisIndex: 1,
				data: volumes,
				itemStyle: {
					color: (params: any) => {
						const idx = params.dataIndex
						return oclh[idx][1] >= oclh[idx][0] ? upColor : downColor
					},
				},
			},
			...(benchmarkPrices
				? [
						{
							name: `年化${annualPct}%基准`,
							type: 'line',
							data: benchmarkPrices,
							smooth: false,
							symbol: 'none',
							lineStyle: { width: 1, color: '#e6a23c', type: 'dashed' as const, opacity: 0.8 },
						},
					]
				: []),
		],
	}
})

onMounted(() => {
	if (route.query.code) {
		selectedCode.value = route.query.code as string
	}
	if (route.query.startDate) {
		startDate.value = route.query.startDate as string
	}
	if (route.query.endDate) {
		endDate.value = route.query.endDate as string
	}
	loadEtfs()
})
</script>

<style scoped>
.header-bar {
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}

.header-left {
	display: flex;
	align-items: center;
	font-size: 16px;
	font-weight: 600;
	gap: 8px;
}
</style>
