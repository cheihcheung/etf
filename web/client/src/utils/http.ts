/**
 * ==========================================================
 * 多资产策略回测系统 - HTTP 客户端工具模块 (HTTP Utils)
 * ==========================================================
 * 本模块基于 Axios 封装了基础的 HTTP 请求实例与统一的拦截器，
 * 为全系统 API 服务层提供统一的数据交互支撑。
 */

import axios from 'axios'

/** Axios 实例基础配置：所有请求默认前缀 /api，超时 60 秒，JSON 格式 */
const request = axios.create({
    baseURL: '/api',
    timeout: 600000, // 10分钟超时（回测计算与大段历史同步可能耗时较长）
    headers: {
        'Content-Type': 'application/json',
    },
})

// ============================================================================
// 响应拦截器 — 统一错误处理
// ============================================================================
// 成功回调：
//   1. 检查后端返回的 success 字段，如果为 false 则视为业务逻辑错误，抛出异常
//   2. 正常情况下直接返回 response.data（剥离 axios 的外层包装）
// 失败回调：
//   1. 优先取后端返回的 error.message
//   2. 其次取 axios 的 error.message
//   3. 兜底返回 "请求失败"
// ============================================================================

request.interceptors.response.use(
    (response) => {
        // 处理 200 + success: false 的业务逻辑错误
        if (response.data && response.data.success === false) {
            const message = response.data.message || '请求失败'
            return Promise.reject(new Error(message))
        }
        return response.data
    },
    (error) => {
        const message = error.response?.data?.message || error.message || '请求失败'
        return Promise.reject(new Error(message))
    }
)

export default request
export { request }
