/**
 * ==========================================================
 * API 客户端封装（web 版 - 仅 HTTP 模式）
 * ==========================================================
 * web 架构专用：所有请求通过 axios 走 HTTP API（由 http.ts 实例发起）。
 * 与 desktop 版完全独立，不包含任何 Electron IPC 逻辑。
 * ==========================================================
 */
import request from './http'

// ==================== ETF 相关接口 ====================
export const etfApi = {
    list: async () => {
        return request.get('/etf/list')
    },

    add: async (data: any) => {
        return request.post('/etf/add', data)
    },

    update: async (data: any) => {
        return request.put('/etf/update', data)
    },

    delete: async (code: string) => {
        return request.delete(`/etf/delete/${code}`)
    },

    quote: async (code: string) => {
        return request.get(`/etf/quote/${code}`)
    },

    search: async (keyword: string) => {
        return request.get('/etf/search', { params: { keyword } })
    },

    syncAll: async () => {
        return request.post('/etf/sync-all')
    },

    syncHistory: async (startDate: string, endDate: string, codes?: string[], dataSource?: string) => {
        return request.post('/etf/sync-history', { startDate, endDate, codes, dataSource })
    },

    history: async (code: string, startDate: string, endDate: string) => {
        return request.get(`/etf/history/${code}`, { params: { startDate, endDate } })
    },

    marketList: async () => {
        return request.get('/etf/market-list')
    }
}

// ==================== 配置相关接口 ====================
export const configApi = {
    getInitialRatios: async () => {
        return request.get('/config/initial-ratios')
    },

    updateInitialRatios: async (ratios: any) => {
        return request.put('/config/initial-ratios', ratios)
    },

    getStrategyA: async () => {
        return request.get('/config/strategy-a')
    },

    updateStrategyA: async (config: any) => {
        return request.put('/config/strategy-a', config)
    },

    getStrategyB: async () => {
        return request.get('/config/strategy-b')
    },

    updateStrategyB: async (config: any) => {
        return request.put('/config/strategy-b', config)
    },

    getEtfTypes: async () => {
        return request.get('/config/etf-types')
    }
}

// ==================== 回测相关接口 ====================
export const backtestApi = {
    run: async (params: any) => {
        return request.post('/backtest/run', params)
    },

    optimize: async (params: any) => {
        return request.post('/backtest/optimize', params)
    },

    results: async () => {
        return request.get('/backtest/results')
    },

    detail: async (id: number) => {
        return request.get(`/backtest/${id}`)
    }
}

// ==================== 交易记录相关接口 ====================
export const recordsApi = {
    trades: async (params?: any) => {
        return request.get('/records/trades', { params })
    },

    market: async () => {
        return request.get('/records/market')
    }
}

// ==================== 系统健康检查 ====================
export const healthCheck = async () => {
    return request.get('/health')
}

export default { etfApi, configApi, backtestApi, recordsApi, healthCheck }
