<template>
	<div class="desktop-app">
		<!-- 顶部标题栏（桌面应用风格） -->
		<header class="title-bar">
			<div class="title-left">
				<el-icon class="app-logo"><DataAnalysis /></el-icon>
				<span class="app-name">ETF 策略系统</span>
			</div>
			<div class="title-right">
				<el-tag v-if="healthStatus" type="success" effect="dark" size="small" round>运行中</el-tag>
				<el-tag v-else type="danger" effect="dark" size="small" round>未连接</el-tag>
				<el-button text size="small" @click="refreshData">
					<el-icon><Refresh /></el-icon>
				</el-button>
			</div>
		</header>

		<!-- 标签页导航栏（桌面风格，类似浏览器/VS Code 标签页） -->
		<nav class="tab-bar">
			<div
				v-for="tab in tabs"
				:key="tab.path"
				class="tab-item"
				:class="{ active: route.path === tab.path }"
				@click="switchTab(tab.path)"
			>
				<el-icon class="tab-icon"><component :is="tab.icon" /></el-icon>
				<span class="tab-label">{{ tab.label }}</span>
			</div>
		</nav>

		<!-- 主内容区 -->
		<main class="content-area">
			<router-view />
		</main>
	</div>
</template>

<script setup lang="ts">
/**
 * ============================================================================
 * 文件：Layout.vue — desktop 桌面风格布局（顶部标签页导航）
 * ============================================================================
 * 布局结构（自上而下）：
 *   1. 标题栏：应用图标 + 名称 + 健康状态 + 刷新按钮
 *   2. 标签栏：4 个一级标签页，点击切换路由，当前标签高亮
 *   3. 内容区：router-view 渲染当前页面
 *
 * 与 web 版的区别：无左侧菜单栏，采用顶部标签页导航，更贴合桌面应用习惯。
 * ============================================================================
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DataAnalysis, Refresh, Coin, Setting, TrendCharts } from '@element-plus/icons-vue'
import { healthCheck } from '@/utils/electron-api'

const route = useRoute()
const router = useRouter()

/** 标签页配置（与路由一一对应） */
const tabs = [
	{ path: '/backtest', label: '回测寻优', icon: DataAnalysis },
	{ path: '/config', label: '股票管理', icon: Coin },
	{ path: '/strategy', label: '策略配置', icon: Setting },
	{ path: '/history', label: '历史走势', icon: TrendCharts },
]

/** 后端健康检查状态（true=连接正常） */
const healthStatus = ref(false)

/** 切换标签页 */
const switchTab = (path: string) => {
	router.push(path)
}

/** 调用健康检查接口检测连接状态 */
const checkHealth = async () => {
	try {
		const res = await healthCheck()
		healthStatus.value = res.status === 'ok' || res.success
	} catch {
		healthStatus.value = false
	}
}

const refreshData = () => {
	checkHealth()
}

onMounted(() => {
	checkHealth()
})
</script>

<style scoped>
.desktop-app {
	display: flex;
	flex-direction: column;
	height: 100vh;
	background: #f0f2f5;
}

/* ============ 顶部标题栏 ============ */
.title-bar {
	height: 44px;
	background: #1d2129;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 16px;
	flex-shrink: 0;
}

.title-left {
	display: flex;
	align-items: center;
	gap: 8px;
}

.app-logo {
	color: #409eff;
	font-size: 18px;
}

.app-name {
	color: #e5eaf3;
	font-size: 14px;
	font-weight: 600;
	letter-spacing: 1px;
}

.title-right {
	display: flex;
	align-items: center;
	gap: 10px;
}

/* ============ 标签页导航栏 ============ */
.tab-bar {
	height: 38px;
	background: #ffffff;
	border-bottom: 1px solid #e4e7ed;
	display: flex;
	align-items: stretch;
	padding: 0 8px;
	flex-shrink: 0;
}

.tab-item {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 16px;
	cursor: pointer;
	color: #606266;
	font-size: 13px;
	border-right: 1px solid #f0f2f5;
	position: relative;
	transition: background 0.15s, color 0.15s;
	user-select: none;
}

.tab-item:hover {
	background: #f5f7fa;
	color: #303133;
}

.tab-item.active {
	color: #409eff;
	background: #f0f7ff;
}

.tab-item.active::after {
	content: '';
	position: absolute;
	left: 0;
	right: 0;
	bottom: -1px;
	height: 2px;
	background: #409eff;
}

.tab-icon {
	font-size: 15px;
}

.tab-label {
	white-space: nowrap;
}

/* ============ 主内容区 ============ */
.content-area {
	flex: 1;
	overflow-y: auto;
	padding: 12px;
}
</style>
