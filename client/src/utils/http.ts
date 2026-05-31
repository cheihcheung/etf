/**
 * ==========================================================
 * ETF多资产动态配置策略系统 - HTTP 客户端工具模块 (HTTP Utils)
 * ==========================================================
 * 本模块基于 Axios 封装了基础的 HTTP 请求实例与统一的拦截器，
 * 为全系统 API 服务层提供统一的数据交互支撑。
 */

import axios from 'axios'

const request = axios.create({
    baseURL: '/api',
    timeout: 60000,
    headers: {
        'Content-Type': 'application/json',
    },
})

// 统一的响应拦截器
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
