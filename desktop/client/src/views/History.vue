<template>
	<div class="etf-history">
		<el-card shadow="hover">
			<template #header>
				<div class="header-bar">
					<div class="header-left">
						<el-select v-model="selectedCode" @change="onEtfChange" style="width: 200px; margin-left: 16px" placeholder="选择股票">
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
						<el-empty description="请选择股票并点击查询" />
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
/**
 * ============================================================================
 * 文件：History.vue — 股票历史 K 线行情查看页面
 * ============================================================================
 *
 * 【页面功能】
 *   1. 选择股票代码 + 日期区间，加载该股票的历史日线 OHLCV 数据
 *   2. 以 K 线图（蜡烛图）+ 成交量柱状图 + 年化基准线的形式展示
 *   3. 下方表格展示详细数据（日期、开/收/高/低、涨跌幅、成交量），支持分页和排序
 *
 * 【图表结构 — 双 Y 轴联动布局】
 *   上方网格（grid[0]）：K 线蜡烛图 + 年化基准虚线
 *   下方网格（grid[1]）：成交量柱状图（与上方共享 X 轴）
 *   两个网格通过 axisPointer.link 实现鼠标联动
 *   dataZoom 支持鼠标滚轮缩放 + 底部滑块拖拽，默认显示最后 10% 数据
 *
 * 【年化基准线计算】
 *   从后端 stock 表获取该标的的 annual_return 字段（历史年化收益率），
 *   以首日收盘价为基准，按复利公式 P = P0 × (1 + r)^(years) 计算每日的"理论价格"。
 *   以虚线形式叠加在 K 线图上，便于直观对比实际走势与年化基准的偏离程度。
 *
 * 【⚠️ K 线数据字段兼容性】
 *   oclh 数组构建时使用了多层 ?? 回退（open_price → openPrice → closePrice → close_price），
 *   这是为了兼容后端 snake_case 和前端 camelCase 两种命名格式。
 *   但如果 openPrice 缺失而回退到 closePrice，则 K 线实体为 0（十字星），可能造成视觉误导。
 *
 * 【数据来源】
 *   通过 Electron IPC 调用 etf:history 接口
 *   主进程从 history_data 表查询，数据由 ipc-handlers.js 从腾讯行情接口抓取（前复权 qfq）
 */
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

// ECharts 按需注册：K 线图 + 柱状图 + 折线图，以及 tooltip/legend/grid/zoom 等组件
use([CandlestickChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, MarkLineComponent, MarkPointComponent, DataZoomComponent, CanvasRenderer])

const route = useRoute()
const router = useRouter()

// ===================== 页面状态 =====================

/** 股票列表（从后端加载） */
const etfList = ref<any[]>([])
/** 当前选中的股票代码 */
const selectedCode = ref('')
/** 当前选中的股票名称 */
const selectedName = ref('')
/** 查询起始日期，默认从 2010-01-01 */
const startDate = ref('2000-01-01')
/** 查询结束日期，默认到今天 */
const endDate = ref(getTodayString())
/** 历史行情数据（按日期升序排列） */
const historyData = ref<any[]>([])
/** 数据加载中状态 */
const loading = ref(false)
/** 是否显示 K 线图表（默认隐藏，点击按钮切换） */
const showChart = ref(false)
/** 分页：当前页码 */
const currentPage = ref(1)
/** 分页：每页条数 */
const pageSize = ref(20)

// ===================== 分页计算 =====================

/**
 * 前端分页数据（按日期降序排列，最新的在前）
 * 表格默认按 tradeDate 降序排列，所以需要 reverse 原始升序数据
 */
const pagedData = computed(() => {
	const desc = [...historyData.value].reverse()
	const start = (currentPage.value - 1) * pageSize.value
	return desc.slice(start, start + pageSize.value)
})

// ===================== 数据加载函数 =====================

/**
 * 加载股票列表，并自动选中第一个加载其历史数据
 * 如果 URL query 中已有 code 参数，则优先使用该参数
 */
const loadEtfs = async () => {
	try {
		const res: any = await etfApi.list()
		etfList.value = res.data || []
		if (etfList.value.length > 0) {
			// 如果尚未选中任何股票，默认选中第一个
			if (!selectedCode.value) {
				selectedCode.value = etfList.value[0].code
				selectedName.value = etfList.value[0].name
			}
			loadData()
		}
	} catch (e: any) {
		ElMessage.error('加载股票列表失败: ' + e.message)
	}
}

/**
 * 股票选择器变化时的回调
 * 更新路由 query 参数（支持浏览器刷新后保持选中状态）并重新加载数据
 */
const onEtfChange = (code: string) => {
	const etf = etfList.value.find((e) => e.code === code)
	selectedName.value = etf?.name || ''
	router.replace({ query: { code } })
	loadData()
}

/**
 * 根据选中的股票代码和日期区间加载历史行情数据
 * 加载成功后自动将分页复位到第 1 页
 */
const loadData = async () => {
	if (!selectedCode.value) {
		ElMessage.warning('请选择股票')
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

// ===================== 年化基准计算 =====================

/** 当前选中股票的年化收益率（从 stock 表的 annual_return 字段获取，百分比） */
const annualReturn = computed(() => {
	const etf = etfList.value.find((e) => e.code === selectedCode.value)
	return etf ? parseFloat(etf.annual_return) || 0 : 0
})

// ===================== K 线图表配置 =====================

/**
 * 【K 线 + 成交量 + 年化基准线 ECharts 配置】
 *
 * 布局采用双网格（grid[0] 上方 K 线，grid[1] 下方成交量），
 * 通过共享 X 轴和 axisPointer.link 实现联动。
 *
 * 系列构成：
 *   1. 日K 蜡烛图（candlestick）— 红(涨)/绿(跌) 配色
 *   2. 成交量柱状图（bar）— 置于下方网格，颜色跟随 K 线涨跌
 *   3. 年化基准线（line，可选）— 当 annualReturn > 0 时显示，
 *      以首日收盘价按复利公式计算的理论价格曲线（橙色虚线）
 *
 * K 线数据格式（ECharts candlestick 要求）：
 *   [开盘价, 收盘价, 最低价, 最高价]
 *   注意顺序是 open, close, low, high（与直觉不同，high 在最后）
 */
const chartOption = computed(() => {
	const data = historyData.value
	if (!data || data.length === 0) return {}

	const dates = data.map((d: any) => d.tradeDate)

	/**
	 * 构建 K 线数据数组（每项为 [open, close, low, high]）
	 * ⚠️ 字段兼容性：同时尝试 snake_case (open_price) 和 camelCase (openPrice)
	 * 如果 openPrice 缺失，回退到 closePrice（此时 K 线实体为 0，显示为十字星）
	 */
	const oclh = data.map((d: any) => {
		const open = d.open_price ?? d.openPrice ?? d.closePrice ?? d.close_price
		const close = d.closePrice ?? d.close_price
		const low = d.low_price ?? d.lowPrice ?? d.closePrice ?? d.close_price
		const high = d.high_price ?? d.highPrice ?? d.closePrice ?? d.close_price
		return [parseFloat(open), parseFloat(close), parseFloat(low), parseFloat(high)]
	})
	/** 成交量数据（单位：手/股，具体取决于后端 spider 抓取时的单位） */
	const volumes = data.map((d: any) => d.volume || 0)

	// ---- 年化基准线计算 ----
	// 以首日收盘价为基准，按复利公式计算每日"理论价格"
	// P(t) = P0 × (1 + annualPct/100) ^ years
	// 其中 years = (当日 - 首日) / 365.25
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

/** 页面挂载：从 URL query 恢复选中状态（code/startDate/endDate），然后加载股票列表 */
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
