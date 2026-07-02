<template>
	<div class="desktop-app">
		<!-- 顶部标题栏（桌面应用风格，无边框窗口） -->
		<header class="title-bar">
			<div class="title-left">
				<el-icon class="app-logo"><DataAnalysis /></el-icon>
				<span class="app-name">股票策略回测系统</span>
			</div>
			<div class="title-right">
				<!-- 窗口控制按钮 -->
				<div class="window-controls">
					<button class="control-btn" @click="minimizeWindow" title="最小化">
						<el-icon :size="14"><Minus /></el-icon>
					</button>
					<button class="control-btn" @click="toggleMaximize" :title="isMaximized ? '还原' : '最大化'">
						<el-icon :size="14">
							<FullScreen v-if="!isMaximized" />
							<CopyDocument v-else />
						</el-icon>
					</button>
					<button class="control-btn close-btn" @click="closeWindow" title="关闭">
						<el-icon :size="14"><Close /></el-icon>
					</button>
				</div>
			</div>
		</header>

		<!-- 标签页导航栏（桌面风格，类似浏览器/VS Code 标签页） -->
		<nav class="tab-bar">
			<div v-for="tab in tabs" :key="tab.path" class="tab-item" :class="{ active: route.path === tab.path }" @click="switchTab(tab.path)">
				<el-icon class="tab-icon"><component :is="tab.icon" /></el-icon>
				<span class="tab-label">{{ tab.label }}</span>
			</div>
			<!-- 健康状态 + 刷新（紧跟在标签页右侧） -->
			<div class="tab-bar-right">
				<el-tag v-if="healthStatus" type="success" effect="dark" size="small" round>运行中</el-tag>
				<el-tag v-else type="danger" effect="dark" size="small" round>未连接</el-tag>
				<el-button text size="small" @click="refreshData" class="refresh-btn" title="刷新连接状态">
					<el-icon class="refresh-icon"><Refresh /></el-icon>
				</el-button>
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
import { DataAnalysis, Refresh, Coin, Setting, TrendCharts, Minus, FullScreen, CopyDocument, Close } from '@element-plus/icons-vue'
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

/** 窗口最大化状态 */
const isMaximized = ref(false)

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

/** 窗口控制函数 */
const minimizeWindow = () => {
	;(window as any).electronAPI?.window?.minimize()
}

const toggleMaximize = async () => {
	await (window as any).electronAPI?.window?.toggleMaximize()
	isMaximized.value = await (window as any).electronAPI?.window?.isMaximized()
}

const closeWindow = () => {
	;(window as any).electronAPI?.window?.close()
}

/** 获取窗口最大化状态 */
const getWindowMaximizedState = async () => {
	if ((window as any).electronAPI?.window?.isMaximized) {
		isMaximized.value = await (window as any).electronAPI.window.isMaximized()
	}
}

onMounted(() => {
	checkHealth()
	getWindowMaximizedState()
})
</script>

<style scoped>
.desktop-app {
	display: flex;
	flex-direction: column;
	height: 100vh;
	background: #f0f2f5;
}

/* ============ 顶部标题栏（可拖拽） ============ */
.title-bar {
	height: 44px;
	background: #1d2129;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 16px;
	flex-shrink: 0;
	-webkit-app-region: drag; /* 整个标题栏可拖拽移动窗口 */
}

.title-left {
	display: flex;
	align-items: center;
	gap: 8px;
	-webkit-app-region: drag;
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
	-webkit-app-region: no-drag; /* 右侧按钮区域不可拖拽 */
}

/* ============ 窗口控制按钮 ============ */
.window-controls {
	display: flex;
	gap: 4px;
	margin-left: 8px;
}

.control-btn {
	width: 32px;
	height: 32px;
	border: none;
	color: rgba(255, 255, 255, 0.8);
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 6px;
	transition: all 0.2s ease;
	background: transparent;
}

.control-btn:hover {
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
}

.close-btn:hover {
	background: #ff5f57 !important;
	color: white !important;
}

/* ============ 标签页导航栏（不可拖拽） ============ */
.tab-bar {
	height: 38px;
	background: #ffffff;
	border-bottom: 1px solid #e4e7ed;
	display: flex;
	align-items: stretch;
	padding: 0 8px;
	flex-shrink: 0;
	-webkit-app-region: no-drag; /* 标签栏不可拖拽 */
}

.tab-bar-right {
	display: flex;
	align-items: center;
	margin-left: auto; /* 推到最右侧 */
	gap: 6px;
	padding-right: 4px;
}

.refresh-btn {
	height: 24px;
	width: 24px;
	padding: 0;
	border-radius: 12px;
	color: #fff;
	background: #409eff;
	border: none;
	transition: all 0.2s;
	display: flex;
	align-items: center;
	justify-content: center;
}

.refresh-btn:hover {
	background: #409eff !important;
	color: #fff;
}

.refresh-btn:hover .refresh-icon {
	transform: rotate(60deg);
}

.refresh-icon {
	transition: transform 0.3s ease;
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
	transition:
		background 0.15s,
		color 0.15s;
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

/* ============ 主内容区（不可拖拽） ============ */
.content-area {
	flex: 1;
	overflow-y: auto;
	padding: 12px;
	-webkit-app-region: no-drag; /* 内容区不可拖拽，所有功能可正常点击 */
}
</style>
