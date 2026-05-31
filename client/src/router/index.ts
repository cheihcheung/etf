import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
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
                path: 'etf-config',
                name: 'EtfConfig',
                component: () => import('../views/EtfConfig.vue'),
                meta: { title: 'ETF管理', icon: 'Coin' },
            },
            {
                path: 'strategy-config',
                name: 'StrategyConfig',
                component: () => import('../views/StrategyConfig.vue'),
                meta: { title: '策略配置', icon: 'Setting' },
            },
            {
                path: 'etf-history',
                name: 'EtfHistory',
                component: () => import('../views/EtfHistory.vue'),
                meta: { title: '历史走势', icon: 'TrendCharts' },
            },
        ],
    },
]

const router = createRouter({
    history: createWebHistory(),
    routes,
})

export default router
