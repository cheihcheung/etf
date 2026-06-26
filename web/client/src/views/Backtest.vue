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
						<el-form-item>
							<template #label>
								<span class="custom-form-label">
									再平衡阈值(%)
									<el-tooltip content="请在下方『策略组合』中勾选『再平衡』以启用此参数调整" placement="top" effect="dark">
										<el-icon class="info-icon"><InfoFilled /></el-icon>
									</el-tooltip>
								</span>
							</template>
							<el-input-number v-model="params.rebalanceThreshold" :min="0" :max="20" :step="0.1" :precision="1" style="width: 100%" :disabled="!enableRebalance" />
						</el-form-item>
					</el-col>
					<el-col :span="8">
						<el-form-item>
							<template #label>
								<span class="custom-form-label">
									策略优先级
									<el-tooltip content="仅在启用多种调仓策略（如再平衡、策略A、策略B中的任意两个及以上）时生效，用于裁决决策发生冲突时的首选策略" placement="top" effect="dark">
										<el-icon class="info-icon"><InfoFilled /></el-icon>
									</el-tooltip>
								</span>
							</template>
							<el-select v-model="params.strategyPriority" style="width: 100%" :disabled="!enablePrioritySelect" placeholder="请选择优先级（可选）" clearable>
								<el-option label="再平衡优先" value="rebalance" />
								<el-option label="策略A优先" value="strategy_a" />
								<el-option label="策略B优先" value="strategy_b" />
							</el-select>
						</el-form-item>
					</el-col>
					<el-col :span="8">
						<el-form-item>
							<template #label>
								<span class="custom-form-label">
									组合年化中枢(%)
									<el-tooltip content="仅在下方『策略组合』中启用『策略B（年化中枢估值偏离策略）』时生效" placement="top" effect="dark">
										<el-icon class="info-icon"><InfoFilled /></el-icon>
									</el-tooltip>
								</span>
							</template>
							<el-input-number v-model="params.centralAnnual" :min="1" :max="30" :step="0.5" :precision="1" style="width: 100%" :disabled="!enableStrategyB" />
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
					<el-table-column v-if="result?.benchmarkMetrics" :label="(result?.benchmarkMetrics?.name || '对比基准')" align="center" min-width="120">
						<template #default="{ row }">
							<span class="result-cell benchmark">{{ row.benchmark }}{{ row.unit }}</span>
						</template>
					</el-table-column>
					<el-table-column v-if="result?.benchmarkMetrics" label="策略超额/优化" align="center" min-width="120" fixed="right">
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
				<el-tab-pane label="历年盈亏">
					<div style="height: 420px">
						<v-chart :option="yearlyChartOption" style="height: 100%" autoresize />
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
										maximumFractionDigits: 2,
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
					<el-table-column prop="etfCode" label="股票代码" width="80" align="center" />
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
			<div v-if="optimizationResult.bestParams" style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px">
				<el-alert title="最优参数" type="success" show-icon :description="bestParamsDesc" style="flex: 1; margin-bottom: 0" />
				<el-button type="success" @click="applyBestParams" style="white-space: nowrap; height: 60px">一键应用<br>最优参数</el-button>
			</div>
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
					<span style="font-size: 12px; color: #909399">仅展示最新500条精简记录</span>
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
				<el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="[10, 20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" :total="historyResults.length" background />
			</div>
		</el-card>

		<el-dialog v-model="optimizeDialogVisible" title="参数寻优设置" width="580px">
			<el-alert title="寻优说明" type="info" :closable="false" show-icon style="margin-bottom: 16px">
				<template #default>系统将在指定范围内遍历所有参数组合，按年化收益排序输出最优配置。组合数 = 各参数取值数相乘。</template>
			</el-alert>
			<el-form label-width="170px">
				<el-form-item v-if="enableRebalance">
					<template #label>
						<span>再平衡阈值范围(%)</span>
					</template>
					<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
						<el-input-number v-model="optimRebMin" :min="0.5" :max="20" :step="0.5" :precision="1" style="width: 110px" placeholder="最小" />
						<span style="color:#909399">~</span>
						<el-input-number v-model="optimRebMax" :min="0.5" :max="20" :step="0.5" :precision="1" style="width: 110px" placeholder="最大" />
						<span style="color:#909399">步长</span>
						<el-input-number v-model="optimRebStep" :min="0.1" :max="5" :step="0.1" :precision="1" style="width: 100px" placeholder="步长" />
						<el-tag type="info">{{ rebalanceOptimCount }} 个值</el-tag>
					</div>
				</el-form-item>
				<el-form-item v-if="enableStrategyB">
					<template #label>
						<span>策略B年化中枢范围(%)</span>
					</template>
					<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
						<el-input-number v-model="optimCentralMin" :min="1" :max="30" :step="0.5" :precision="1" style="width: 110px" placeholder="最小" />
						<span style="color:#909399">~</span>
						<el-input-number v-model="optimCentralMax" :min="1" :max="30" :step="0.5" :precision="1" style="width: 110px" placeholder="最大" />
						<span style="color:#909399">步长</span>
						<el-input-number v-model="optimCentralStep" :min="0.5" :max="5" :step="0.5" :precision="1" style="width: 100px" placeholder="步长" />
						<el-tag type="info">{{ centralOptimCount }} 个值</el-tag>
					</div>
				</el-form-item>
				<el-form-item label="预计组合总数">
					<el-tag :type="totalOptimCombinations > 100 ? 'warning' : 'success'" size="large">
						{{ totalOptimCombinations }} 种组合
						<span v-if="totalOptimCombinations > 200" style="margin-left: 6px; color: #e6a23c">⚠ 数量较多，预计耗时较长</span>
					</el-tag>
				</el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="optimizeDialogVisible = false">取消</el-button>
				<el-button type="warning" @click="runOptimization" :loading="optimizing" :disabled="totalOptimCombinations === 0">开始寻优（{{ totalOptimCombinations }}种）</el-button>
			</template>
		</el-dialog>
	</div>
</template>

<script setup lang="ts">
/**
 * ============================================================================
 * 文件：Backtest.vue — 回测主页面（核心视图）
 * ============================================================================
 *
 * 【页面功能概览】
 * 本页面是整个 ETF 组合回测系统的核心交互入口，包含以下功能区域：
 *
 *   1. 回测参数配置区（日期、资金、费率、频率、策略开关、策略优先级等）
 *   2. 回测结果展示区（核心指标对比表格 + 3 个 ECharts 图表 + 调仓明细表）
 *   3. 参数寻优弹窗与结果展示（网格遍历多个阈值组合，按夏普排序）
 *   4. 历史回测记录列表（分页，支持点击查看某次历史回测的详情）
 *
 * 【数据流向】
 *   前端 params → POST /api/backtest/run → 后端 backtest.js 引擎计算
 *   → 返回 BacktestResult（含 dailyValues / tradeRecords / 指标 / 基准对比）
 *   → 前端 computed 属性自动派生图表配置 → ECharts 渲染
 *
 * 【核心 computed 派生链】
 *   result.dailyValues → chartOption（收益曲线）       ── 组合净值 + 沪深300 + 各ETF独立净值
 *                       → allocationChartOption（配置变动）── 堆叠面积图，显示现金+各ETF占比
 *                       → drawdownChartOption（回撤走势）    ── 负值面积图
 *   result + benchmarkMetrics + etfMetrics → comparisonData（指标对比表格）
 *
 * 【策略开关机制】
 *   strategyToggles 是一个 ref<string[]>，值为 checkbox-group 的选中 label 集合。
 *   三个可用 label：'rebalance' / 'strategyA' / 'strategyB'
 *   初始值 ['rebalance', '', ''] 默认仅启用再平衡。
 *   当启用 ≥2 个策略时，策略优先级下拉框才会解锁。
 *   调仓频率 tradeFrequency 控制引擎的交易日采样粒度（daily/weekly/monthly）。
 *
 * 【费率说明】
 *   params.feeRate 的值含义：0.012 表示 0.012%（即万 1.2）。
 *   后端 calcFee() 内部会执行 amount * feeRate / 100，因此前端传入的是"百分比数字"。
 *   feeExemptFive=true 时，单笔佣金不足 5 元免收（A股惯例）。
 *
 * 【⚠️ 已知注意事项】
 *   1. 图表 X 轴标签间隔通过 Math.ceil(values.length / 8) 动态计算，
 *      当数据点很少（<8）时可能所有日期都显示，造成拥挤。
 *   2. 调仓明细表中的 totalValue 字段来源是 row.totalValue || row.total_value，
 *      兼容了后端 camelCase 和 snake_case 两种命名格式（历史遗留）。
 *   3. 历史记录列表仅展示最新 500 条精简记录（后端路由限制）。
 */
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

// ECharts 按需注册：折线图、柱状图，以及 tooltip/legend/grid/markLine 等组件
use([LineChart, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, MarkLineComponent, CanvasRenderer])

// ===================== 页面状态变量 =====================

/** 是否正在执行单次回测（控制按钮 loading 状态） */
const running = ref(false)
/** 是否正在执行参数寻优（控制寻优按钮 loading 状态） */
const optimizing = ref(false)
/** 是否正在加载历史记录列表（控制表格 v-loading） */
const loadingHistory = ref(false)
/** 参数寻优弹窗是否可见 */
const optimizeDialogVisible = ref(false)

// ===================== 数据存储 =====================

/** 单次回测的结果对象（后端 BacktestResult 结构，包含 dailyValues / tradeRecords / 指标等） */
const result = ref<BacktestResult | null>(null)
/** 参数寻优的结果对象（含 bestParams + sortedResults 排序数组） */
const optimizationResult = ref<any>(null)
/** 历史回测记录列表（精简格式，不含 daily_detail） */
const historyResults = ref<any[]>([])

// ===================== 分页状态 =====================

/** 当前页码 */
const currentPage = ref(1)
/** 每页条数 */
const pageSize = ref(10)

/**
 * 前端分页：根据 currentPage 和 pageSize 从 historyResults 中切片
 * 注：这是纯前端分页，后端一次性返回最多 500 条记录
 */
const pagedHistoryResults = computed(() => {
	const start = (currentPage.value - 1) * pageSize.value
	const end = start + pageSize.value
	return historyResults.value.slice(start, end)
})

// ===================== 回测参数（响应式对象） =====================

/**
 * 回测请求参数对象
 * 各字段含义：
 *   startDate / endDate     — 回测区间
 *   initialCapital          — 初始总资金（元）
 *   feeRate                  — 交易费率，单位为"%"（0.012 = 万1.2），后端 calcFee 内部会 /100
 *   feeExemptFive            — 是否启用"免五"（单笔佣金 < 5 元时免收）
 *   etfs                     — ETF 列表 [{code, name}]，由 loadEtfList 从后端拉取
 *   initialRatios            — 各 ETF 初始配比 {code: ratio}，例如 {'510300': 25}
 *   strategyAConfig          — 策略A 配置对象（从后端 configApi 动态获取，可为 null）
 *   strategyBConfig          — 策略B 配置对象（同上）
 *   rebalanceThreshold       — 再平衡偏离阈值（百分比），例如 2 表示偏离超过 ±2% 时触发
 *   tradeFrequency           — 调仓频率：daily(每日) / weekly(每周) / monthly(每月)
 *   strategyPriority         — 策略冲突优先级：rebalance / strategy_a / strategy_b
 *   centralAnnual            — 策略B 的"年化收益中枢"参考值（百分比）
 *   resetOnHigh              — 策略A 是否在创新高时自动复位 drawdownHighWaterMark
 */
const params = reactive<BacktestParams>({
	startDate: '2005-05-01',
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
	strategyPriority: 'rebalance',
	centralAnnual: 10,
	resetOnHigh: true,
})

// ===================== 策略开关 & 派生状态 =====================

/**
 * 策略组合开关组（el-checkbox-group 的 v-model）
 * 数组中存储被选中的 label 字符串：'rebalance' | 'strategyA' | 'strategyB'
 * 初始值 ['rebalance', '', ''] 表示默认仅启用再平衡
 */
const strategyToggles = ref(['rebalance'])

/** 策略A 是否启用（从 strategyToggles 派生） */
const enableStrategyA = computed(() => strategyToggles.value.includes('strategyA'))
/** 策略B 是否启用（从 strategyToggles 派生） */
const enableStrategyB = computed(() => strategyToggles.value.includes('strategyB'))
/** 再平衡是否启用（从 strategyToggles 派生） */
const enableRebalance = computed(() => strategyToggles.value.includes('rebalance'))

/** 当前启用的策略数量（用于判断是否需要显示策略优先级选择器） */
const activeStrategiesCount = computed(() => {
	let count = 0
	if (enableRebalance.value) count++
	if (enableStrategyA.value) count++
	if (enableStrategyB.value) count++
	return count
})
/** 仅当启用 ≥2 个策略时，才允许选择策略优先级（避免单一策略时优先级无意义） */
const enablePrioritySelect = computed(() => activeStrategiesCount.value >= 2)

// ===================== 参数寻优相关 =====================

// ===================== 参数寻优相关 =====================

/** 再平衡阈值寻优区间参数 */
const optimRebMin = ref(1.0)
const optimRebMax = ref(3.0)
const optimRebStep = ref(0.5)

/** 策略B中枢年化寻优区间参数 */
const optimCentralMin = ref(8.0)
const optimCentralMax = ref(12.0)
const optimCentralStep = ref(1.0)

/** 根据 min/max/step 展开成数组（工具函数） */
const expandRange = (min: number, max: number, step: number): number[] => {
	const result: number[] = []
	if (step <= 0 || min > max) return result
	let cur = min
	while (cur <= max + 1e-9) {
		result.push(parseFloat(cur.toFixed(2)))
		cur += step
	}
	return result
}

/** 再平衡阈值遍历的数量 */
const rebalanceOptimCount = computed(() => enableRebalance.value ? expandRange(optimRebMin.value, optimRebMax.value, optimRebStep.value).length : 0)
/** 策略B中枢年化遍历的数量 */
const centralOptimCount = computed(() => enableStrategyB.value ? expandRange(optimCentralMin.value, optimCentralMax.value, optimCentralStep.value).length : 0)
/** 总组合数 = 各维度数量相乘（至少1） */
const totalOptimCombinations = computed(() => {
	let count = 1
	if (enableRebalance.value && rebalanceOptimCount.value > 0) count *= rebalanceOptimCount.value
	if (enableStrategyB.value && centralOptimCount.value > 0) count *= centralOptimCount.value
	return count
})

/**
 * 寻优结果中最优参数的描述文本（用于 el-alert 展示）
 * 格式示例："年化: 12.34%, 最大回撤: -15.67%, 夏普: 1.2345"
 */
const bestParamsDesc = computed(() => {
	if (!optimizationResult.value?.bestParams) return ''
	const bp = optimizationResult.value.bestParams
	const p = bp.params || {}
	const paramStr = Object.entries(p).map(([k, v]) => `${k}=${v}`).join(', ')
	return `参数: ${paramStr} | 年化: ${bp.annualReturn?.toFixed(2)}%, 最大回撤: ${bp.maxDrawdown?.toFixed(2)}%, 夏普: ${bp.sharpeRatio?.toFixed(4)}`
})

/** 当前回测结果中涉及的 ETF 代码列表（用于动态生成对比表格列） */
const etfMetricCodes = computed(() => {
	return Object.keys(result.value?.etfMetrics || {})
})

/**
 * 【核心指标对比表格数据】
 * 将回测结果的核心指标整理为表格行数据，每行包含：
 *   - 组合值（我的策略组合）
 *   - 基准值（沪深300）
 *   - 各 ETF 单独持有的指标值（动态列）
 *   - 差异值（组合 vs 基准），用于展示超额收益
 *
 * "越低越好"的指标（最大回撤、年化波动率）：isBetter 判断为 组合 < 基准
 * "越高越好"的指标（总收益、年化、夏普）：isBetter 判断为 组合 > 基准
 * diff 始终计算为 "正值表示优于基准" 的方向
 */
const comparisonData = computed(() => {
	if (!result.value) return []
	const r = result.value
	// 基准指标（沪深300），如果没有则全部填充 0
	const b = r.benchmarkMetrics || {
		totalReturn: 0,
		annualReturn: 0,
		maxDrawdown: 0,
		annualVolatility: 0,
		sharpeRatio: 0,
	}
	// 各 ETF 单独持有的指标集合 {code: {totalReturn, annualReturn, ...}}
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

/**
 * 【收益对比曲线图 ECharts 配置】
 *
 * 图表系列构成：
 *   1. 组合净值（红色粗线）— 所有 ETF 按策略调仓后的组合总资产
 *   2. 沪深300（灰色线）   — 同期沪深300指数作为基准
 *   3. 各 ETF 独立净值线    — 如果把全部资金单独持有某个 ETF 的净值走势（默认不选中/半透明）
 *
 * 性能优化：
 *   所有折线启用 LTTB 降采样（Largest Triangle Three Buckets），
 *   当数据点数 > 图表像素宽度时自动降采样，大幅提升渲染性能。
 *
 * 图例策略：
 *   ETF 独立线在 legend.selected 中默认设为 false（不选中），
 *   用户可手动点击图例切换显示/隐藏，避免初始界面过于拥挤。
 */
const chartOption = computed(() => {
	if (!result.value?.dailyValues) return {}
	const values = result.value.dailyValues
	// 从第一条 dailyValues 中提取所有 ETF 代码
	const etfCodes = Object.keys(values[0]?.etfPerformances || {})

	// 提取策略A/B的调仓日期集合（去重），用于在收益曲线上标注
	const tradeRecords = result.value?.tradeRecords || []
	const strategyADates = [...new Set(tradeRecords.filter((t: any) => t.type === 'strategy_a').map((t: any) => t.date))]
	const strategyBDates = [...new Set(tradeRecords.filter((t: any) => t.type === 'strategy_b').map((t: any) => t.date))]

	// 构建 markLine 数据：策略A用橙色，策略B用蓝色，最多各展示30条避免过度拥挤
	const markLineData: any[] = [
		...strategyADates.slice(0, 30).map((date: any) => ({
			xAxis: date,
			label: { formatter: 'A', position: 'insideEndTop', fontSize: 9 },
			lineStyle: { color: '#e6a23c', type: 'dashed', width: 1, opacity: 0.8 }
		})),
		...strategyBDates.slice(0, 30).map((date: any) => ({
			xAxis: date,
			label: { formatter: 'B', position: 'insideEndBottom', fontSize: 9 },
			lineStyle: { color: '#409eff', type: 'dashed', width: 1, opacity: 0.8 }
		}))
	]

	const hasBenchmark = !!result.value?.benchmarkMetrics
	const benchmarkLabel = result.value?.benchmarkMetrics?.name || '对比基准'

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
			z: 10, // 置于最顶层，确保组合线不被 ETF 线遮挡
			markLine: markLineData.length > 0 ? {
				silent: false,
				symbol: 'none',
				data: markLineData,
				label: { show: true }
			} : undefined
		}
	]

	if (hasBenchmark) {
		series.push({
			name: benchmarkLabel,
			type: 'line',
			data: values.map((v) => v.benchmarkValue),
			smooth: true,
			showSymbol: false,
			sampling: 'lttb',
			lineStyle: { width: 2 },
			itemStyle: { color: '#909399' },
		} as any)
	}

	// 动态为每个 ETF 生成独立净值线
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
			itemStyle: { opacity: 0.5 } as any, // 半透明，与组合线做视觉区分
			selected: false, // 默认不选中，用户可在图例中手动开启
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
			data: hasBenchmark
				? ['组合净值', benchmarkLabel, ...etfCodes.map((c) => result.value?.etfMetrics?.[c]?.name || c)]
				: ['组合净值', ...etfCodes.map((c) => result.value?.etfMetrics?.[c]?.name || c)],
			// ETF 线默认不选中（selected: false），减少初始视觉干扰
			selected: etfCodes.reduce((acc, c) => ({ ...acc, [result.value?.etfMetrics?.[c]?.name || c]: false }), {}),
			bottom: 10,
			type: 'scroll', // ETF 数量多时可滚动
		},
		grid: { left: '3%', right: '4%', top: '5%', bottom: '15%', containLabel: true },
		xAxis: {
			type: 'category',
			data: values.map((v) => v.date),
			axisLabel: {
				fontSize: 10,
				// 动态计算 X 轴标签间隔，目标约显示 8 个日期刻度
				interval: Math.ceil(values.length / 8),
			},
			boundaryGap: false,
		},
		yAxis: {
			type: 'value',
			scale: true, // 不强制从 0 开始，充分利用图表高度展示差异
			axisLabel: {
				formatter: (val: number) => (val / 10000).toFixed(1) + '万',
			},
		},
		series,
	}
})

/**
 * 【资产配置变动堆叠面积图 ECharts 配置】
 *
 * 展示每个交易日的资产占比分布：
 *   - 现金占比（最底层）
 *   - 各 ETF 占比（累加堆叠，总和 = 100%）
 *
 * 通过 ECharts 的 stack:'Total' 实现堆叠面积图，
 * 可以直观看出：某 ETF 何时被加仓/减仓、现金比例的变化趋势。
 */
const allocationChartOption = computed(() => {
	if (!result.value?.dailyValues || result.value.dailyValues.length === 0) return {}
	const values = result.value.dailyValues
	// 从 assetRatios 中提取 ETF 代码，排除 'cash'
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

/**
 * 【回撤走势面积图 ECharts 配置】
 *
 * 展示组合净值的每日回撤幅度（百分比），Y 轴 max: 0 确保只显示负值区域。
 * 面积填充为红色半透明，直观展示亏损区间和回撤恢复过程。
 * 回撤值 = (当前净值 - 历史最高净值) / 历史最高净值 × 100
 */
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

/**
 * 【历年盈亏分布柱状图 ECharts 配置】
 * 按年展示策略组合与沪深300的年度收益率，正值绿色、负值红色，双柱并排对比
 */
const yearlyChartOption = computed(() => {
	const yearly = result.value?.yearlyStats
	if (!yearly || yearly.length === 0) return {}
	
	const hasBenchmark = !!result.value?.benchmarkMetrics
	const benchmarkLabel = result.value?.benchmarkMetrics?.name || '对比基准'

	const years = yearly.map((y: any) => y.year)
	const strategyData = yearly.map((y: any) => ({
		value: y.strategyReturn,
		itemStyle: { color: y.strategyReturn >= 0 ? '#f56c6c' : '#67c23a' }
	}))
	const benchmarkData = yearly.map((y: any) => ({
		value: y.benchmarkReturn,
		itemStyle: { color: y.benchmarkReturn >= 0 ? 'rgba(245,108,108,0.4)' : 'rgba(103,194,58,0.4)' }
	}))
	
	const seriesList = [
		{ name: '策略组合', type: 'bar', data: strategyData, barGap: '10%', barMaxWidth: 40 }
	]
	if (hasBenchmark) {
		seriesList.push({ name: benchmarkLabel, type: 'bar', data: benchmarkData, barMaxWidth: 40 } as any)
	}

	return {
		tooltip: {
			trigger: 'axis',
			formatter: (params: any) => {
				const year = params[0].name
				let html = `<b>${year}年</b><br/>`
				params.forEach((p: any) => {
					const color = p.value >= 0 ? '#f56c6c' : '#67c23a'
					html += `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px"></span>${p.seriesName}: <b style="color:${color}">${p.value >= 0 ? '+' : ''}${p.value}%</b><br/>`
				})
				return html
			}
		},
		legend: { 
			data: hasBenchmark ? ['策略组合', benchmarkLabel] : ['策略组合'], 
			bottom: 0 
		},
		grid: { left: '3%', right: '4%', top: '10%', bottom: '15%', containLabel: true },
		xAxis: { type: 'category', data: years, axisLabel: { fontSize: 12 } },
		yAxis: {
			type: 'value',
			name: '年度收益率(%)',
			axisLabel: { formatter: (val: number) => `${val}%` },
			splitLine: { lineStyle: { type: 'dashed' } }
		},
		series: seriesList
	}
})

/** 金额格式化：将数字转为人民币格式（带 ¥ 前缀和千分位） */
const formatMoney = (val: number) => {
	if (!val && val !== 0) return '¥0.00'
	return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * 加载 ETF 列表及初始配比
 * 1. 调用 etfApi.list() 获取所有已配置的 ETF（code + name）
 * 2. 调用 configApi.getInitialRatios() 获取各 ETF 的初始配比
 * 3. 将配比数据填充到 params.etfs 和 params.initialRatios 中
 */
const loadEtfList = async () => {
	try {
		const etfRes = await etfApi.list()
		const etfs = (etfRes as any).data || []
		params.etfs = etfs.map((e: any) => ({ code: e.code, name: e.name, scale_factor: e.scale_factor }))

		// 补回比例加载逻辑
		const ratioRes: any = await configApi.getInitialRatios()
		const ratios = ratioRes.data || []
		const ratioMap: Record<string, number> = {}
		ratios.forEach((r: any) => {
			ratioMap[r.etfCode] = parseFloat(r.ratio)
		})
		params.initialRatios = ratioMap
	} catch (e: any) {
		ElMessage.error('加载股票及比例失败: ' + e.message)
	}
}

const loadStrategyBConfig = async () => {
	try {
		const res: any = await configApi.getStrategyB()
		if (res.data && res.data.centralAnnual != null) {
			params.centralAnnual = res.data.centralAnnual
		}
	} catch (e: any) {
		console.error('加载策略B配置失败:', e)
	}
}

/**
 * 执行单次回测
 * 流程：
 *   1. 根据策略开关状态，动态从后端拉取策略A/策略B的最新配置
 *      （如果策略未启用则传入 null，后端引擎会跳过该策略）
 *   2. 根据再平衡开关生成 rebalanceConfig 标识
 *   3. 将完整 params 发送到 POST /api/backtest/run
 *   4. 成功后将结果存入 result（触发所有 computed 图表重新渲染）
 *   5. 同时刷新历史记录列表（新回测结果会出现在历史中）
 */
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

/**
 * 执行参数寻优
 * 与 runBacktest 类似，但会：
 *   1. 将当前参数作为 baseParams，加上 optimizationRanges（待遍历的参数范围）
 *   2. 发送到 POST /api/backtest/optimize
 *   3. 后端对每个参数组合执行完整回测，返回按夏普比率排序的结果
 *   4. 完成后关闭弹窗并展示寻优结果
 */
/**
 * 执行参数寻优（新版：支持区间遍历再平衡阈值 + 策略B中枢年化）
 * 1. 根据用户设置的 min/max/step 生成候选值数组
 * 2. 将候选数组作为 optimizationRanges 传给后端
 * 3. 后端对每个参数组合执行完整回测，返回按年化排序的结果
 */
const runOptimization = async () => {
	optimizing.value = true
	optimizationResult.value = null
	try {
		// 从区间设置展开成候选值数组
		const optimizationRanges: Record<string, number[]> = {}
		if (enableRebalance.value) {
			const rebValues = expandRange(optimRebMin.value, optimRebMax.value, optimRebStep.value)
			if (rebValues.length > 0) optimizationRanges.rebalanceThreshold = rebValues
		}
		if (enableStrategyB.value) {
			const centralValues = expandRange(optimCentralMin.value, optimCentralMax.value, optimCentralStep.value)
			if (centralValues.length > 0) optimizationRanges.centralAnnual = centralValues
		}

		const optimParams = {
			baseParams: { ...params },
			optimizationRanges,
		}
		optimParams.baseParams.strategyAConfig = enableStrategyA.value ? (await configApi.getStrategyA()).data : null
		optimParams.baseParams.strategyBConfig = enableStrategyB.value ? (await configApi.getStrategyB()).data : null
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

/**
 * 一键应用最优参数到当前回测设置
 * 将寻优结果中最优参数的各字段更新到 params 对象
 */
const applyBestParams = () => {
	const bp = optimizationResult.value?.bestParams
	if (!bp?.params) return
	const p = bp.params
	if (p.rebalanceThreshold != null) params.rebalanceThreshold = p.rebalanceThreshold
	if (p.centralAnnual != null) params.centralAnnual = p.centralAnnual
	ElMessage.success(`最优参数已应用：${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(', ')}`)
}

/**
 * 加载历史回测记录（精简列表，不含 daily_detail）
 * 加载成功后自动将 currentPage 复位到第 1 页
 */
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

/**
 * 查看某条历史回测记录的详细数据
 * 从后端获取 daily_detail（可能是 JSON 字符串或已解析的对象），
 * 解析后赋值给 result，触发图表和指标表格重新渲染
 */
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

// ============================================================================
// 调仓流水表格 — 行合并算法
// ============================================================================
// 背景：同一天可能发生多笔交易（买入/卖出不同的 ETF），在表格中需要将
//       相同日期的行进行"日期"和"账户总额"两列的视觉合并。
//
// 算法：前向扫描，维护 spanArr 数组：
//   - spanArr[i] = N 表示第 i 行需要向下合并 N 行（rowspan=N）
//   - spanArr[i] = 0 表示该行被上一行合并，不渲染自己的单元格
//
// 配合 el-table 的 :span-method 属性实现 Element Plus 表格行合并。
// ============================================================================

const spanArr = ref<number[]>([])
/** 当前合并段的起始行索引 */
let position = 0

/**
 * 监听 tradeRecords 变化，重新计算行合并数组 spanArr
 * 当回测结果更新（result.tradeRecords 改变）或首次加载时触发
 */
watch(
	() => result.value?.tradeRecords,
	(newRecords) => {
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
					// 日期不同，开始新的合并段
					spanArr.value.push(1)
					position = i
				}
			}
		}
	},
	{ immediate: true },
)

/**
 * el-table 的 span-method 回调
 * 对”日期”（第 0 列）和”账户总额”（第 1 列）执行行合并：
 *   - 如果 spanArr[rowIndex] > 0：该行是合并的起始行，rowspan = spanArr[rowIndex]
 *   - 如果 spanArr[rowIndex] === 0：该行被合并，rowspan = 0（不渲染单元格）
 */
const objectSpanMethod = ({ rowIndex, columnIndex }: any) => {
	if (columnIndex === 0 || columnIndex === 1) {
		const _row = spanArr.value[rowIndex]
		const _col = _row > 0 ? 1 : 0
		return {
			rowspan: _row,
			colspan: _col,
		}
	}
}

/** 页面挂载时并行加载 ETF 列表和历史回测记录 */
onMounted(async () => {
	await Promise.all([loadEtfList(), loadHistory(), loadStrategyBConfig()])
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

.custom-form-label {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.info-icon {
	color: #909399;
	font-size: 14px;
	cursor: pointer;
	transition: color 0.2s ease;
	vertical-align: middle;
}

.info-icon:hover {
	color: #409eff;
}

/* 使得禁用的输入框样式更加美观柔和 */
:deep(.el-input.is-disabled .el-input__inner) {
	color: #c0c4cc;
	-webkit-text-fill-color: #c0c4cc;
}
</style>
