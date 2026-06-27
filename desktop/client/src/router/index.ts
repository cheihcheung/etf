/**
 * ============================================================================
 * 文件：router/index.ts — Vue Router 路由配置
 * ============================================================================
 *
 * 【路由结构】
 *   所有页面都嵌套在 Layout 组件下（共享侧边栏和顶部导航），
 *   根路径 '/' 重定向到 '/backtest'（回测页面作为首页）。
 *
 *   /backtest     → Backtest.vue     回测与参数寻优（系统核心页面）
 *   /config       → Config.vue       股票标的管理 + 初始比例配置
 *   /strategy     → Strategy.vue     策略A/B 档位配置
 *   /history      → History.vue      股票历史 K 线行情查看
 *
 * 【懒加载】
 *   所有页面组件使用动态 import() 进行代码分割（chunk splitting），
 *   首屏仅加载 Layout 组件，其他页面按需加载，优化首屏加载速度。
 *
 * 【meta 字段】
 *   title — 页面标题，显示在 Layout 顶部导航栏的 <h2> 中
 *   icon  — 图标名称（仅在路由定义中作为备注使用，侧边栏图标在 Layout 模板中硬编码）
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import Layout from '../components/Layout.vue'

const routes: RouteRecordRaw[] = [
    {
        path: '/',
        component: Layout,
        redirect: '/backtest',
        children: [
            {
                path: 'backtest',
                name: 'Backtest',
                component: () => import('../views/Backtest.vue'),
                meta: { title: '回测与参数寻优', icon: 'DataAnalysis' },
            },
            {
                path: 'config',
                name: 'Config',
                component: () => import('../views/Config.vue'),
                meta: { title: '股票管理', icon: 'Coin' },
            },
            {
                path: 'strategy',
                name: 'Strategy',
                component: () => import('../views/Strategy.vue'),
                meta: { title: '策略配置', icon: 'Setting' },
            },
            {
                path: 'history',
                name: 'History',
                component: () => import('../views/History.vue'),
                meta: { title: '历史走势', icon: 'TrendCharts' },
            },
        ],
    },
]

const router = createRouter({
    history: createWebHashHistory(),  // Electron 环境使用 hash 路由，兼容 file:// 和 app:// 协议
    routes,
})

export default router
