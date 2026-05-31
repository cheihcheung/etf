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
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Monitor, Coin, Setting, DataAnalysis, Refresh } from '@element-plus/icons-vue'
import axios from 'axios'

const route = useRoute()
const router = useRouter()
const isCollapse = ref(false)
const healthStatus = ref(false)

const toggleCollapse = () => {
	isCollapse.value = !isCollapse.value
}

const handleMenuSelect = (index: string) => {
	router.push(index)
}

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
