<template>
	<el-container style="height: 100vh">
		<el-aside :width="isCollapse ? '64px' : '180px'" class="app-sidebar">
			<div class="sidebar-header">
				<span v-if="!isCollapse" class="sidebar-title">ETF策略系统</span>
				<span v-else class="sidebar-title-short">ETF</span>
			</div>
			<el-menu :default-active="route.path" :collapse="isCollapse" :collapse-transition="false" background-color="#1d1e1f" text-color="#bfcbd9" active-text-color="#409eff" @select="handleMenuSelect">
				<el-menu-item index="/backtest">
					<el-icon><DataAnalysis /></el-icon>
					<span>回测寻优</span>
				</el-menu-item>
				<el-sub-menu index="/etf">
					<template #title>
						<el-icon><Coin /></el-icon>
						<span>ETF管理</span>
					</template>
					<el-menu-item index="/etf-config">
						<span>ETF配置</span>
					</el-menu-item>
					<el-menu-item index="/etf-history">
						<span>历史走势</span>
					</el-menu-item>
				</el-sub-menu>
				<el-menu-item index="/strategy-config">
					<el-icon><Setting /></el-icon>
					<span>策略配置</span>
				</el-menu-item>
			</el-menu>
		</el-aside>
		<el-container class="main-container">
			<el-header class="app-header">
				<div class="header-left">
					<el-button :icon="isCollapse ? 'Expand' : 'Fold'" text @click="toggleCollapse" style="color: #606266; margin-right: 8px" />
					<h2>{{ route.meta.title }}</h2>
				</div>
				<div class="header-right">
					<el-tag v-if="healthStatus" type="success" effect="dark">系统运行中</el-tag>
					<el-tag v-else type="danger" effect="dark">未连接</el-tag>
					<el-button text @click="refreshData">
						<el-icon><Refresh /></el-icon>
						刷新
					</el-button>
				</div>
			</el-header>
			<el-main class="app-main">
				<router-view />
			</el-main>
		</el-container>
	</el-container>
</template>

<script setup lang="ts">
/**
 * ============================================================================
 * 文件：Layout.vue — 全局布局组件（侧边栏 + 顶部导航 + 主内容区）
 * ============================================================================
 *
 * 【布局结构】
 *   el-container（全屏高度）
 *   ├── el-aside（侧边栏，可折叠：展开 180px / 折叠 64px）
 *   │     ├── Logo / 标题区域
 *   │     └── el-menu（导航菜单，深色主题 #1d1e1f）
 *   │           ├── 回测寻优（/backtest）
 *   │           ├── ETF管理（子菜单）
 *   │           │     ├── ETF配置（/etf-config）
 *   │           │     └── 历史走势（/etf-history）
 *   │           └── 策略配置（/strategy-config）
 *   └── el-container
 *         ├── el-header（顶部栏：折叠按钮 + 页面标题 + 健康状态标签 + 刷新按钮）
 *         └── el-main（主内容区，通过 <router-view /> 渲染当前路由对应的页面组件）
 *
 * 【健康检查】
 *   页面挂载时调用 GET /api/health 检测后端连接状态，
 *   在 header 右侧显示绿色"系统运行中"或红色"未连接"标签
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Monitor, Coin, Setting, DataAnalysis, Refresh } from '@element-plus/icons-vue'
import axios from 'axios'

const route = useRoute()
const router = useRouter()
/** 侧边栏是否折叠 */
const isCollapse = ref(false)
/** 后端健康检查状态（true=连接正常） */
const healthStatus = ref(false)

/** 切换侧边栏折叠/展开状态 */
const toggleCollapse = () => {
	isCollapse.value = !isCollapse.value
}

/** 导航菜单点击事件：使用 router.push 进行页面跳转 */
const handleMenuSelect = (index: string) => {
	router.push(index)
}

/** 调用后端 /api/health 接口检测连接状态 */
const checkHealth = async () => {
	try {
		const res = await axios.get('/api/health')
		healthStatus.value = res.data.status === 'ok'
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
.app-sidebar {
	background-color: #1d1e1f;
	transition: width 0.3s;
	display: flex;
	flex-direction: column;
}

.sidebar-header {
	height: 60px;
	display: flex;
	align-items: center;
	justify-content: center;
	color: #fff;
	font-size: 18px;
	font-weight: bold;
	border-bottom: 1px solid #333;
}

.sidebar-title {
	letter-spacing: 2px;
}

.sidebar-title-short {
	font-size: 16px;
}

.app-header {
	background: #fff;
	border-bottom: 1px solid #e4e7ed;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 20px;
	height: 60px;
}

.header-left {
	display: flex;
	align-items: center;
}

.header-left h2 {
	font-size: 18px;
	font-weight: 600;
	color: #303133;
	margin: 0;
}

.header-right {
	display: flex;
	align-items: center;
	gap: 12px;
}

.app-main {
	background: #f5f7fa;
	padding: 12px;
	overflow-y: auto;
}

.main-container {
	height: 100%;
}

.el-menu {
	border-right: none;
}
</style>
