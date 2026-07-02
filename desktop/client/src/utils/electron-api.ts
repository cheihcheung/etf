/**
 * ==========================================================
 * API 客户端封装（desktop 版 - 仅 IPC 模式）
 * ==========================================================
 * desktop 架构专用：所有请求通过 Electron IPC 与主进程通信。
 * 与 web 版完全独立，不包含任何 HTTP 逻辑。
 * ==========================================================
 */

/**
 * 将 Vue 3 响应式对象（Proxy）转换为纯 JSON 对象
 * 解决 Electron contextBridge 无法克隆 Proxy 的问题
 */
function toPlain<T>(data: T): T {
    if (data === null || data === undefined) {
        return data
    }
    return JSON.parse(JSON.stringify(data))
}

// ==================== ETF 相关接口 ====================
export const etfApi = {
    list: async () => {
        const res = await (window as any).electronAPI.etf.list()
        if (res.success) return { data: res.data }
        throw new Error(res.message || '请求失败')
    },

    add: async (data: any) => {
        const res = await (window as any).electronAPI.etf.add(toPlain(data))
        if (res.success) return { data: res.data, message: res.message }
        throw new Error(res.message || '添加失败')
    },

    update: async (data: any) => {
        const res = await (window as any).electronAPI.etf.update(toPlain(data))
        if (res.success) return { data: res.data, message: res.message }
        throw new Error(res.message || '更新失败')
    },

    delete: async (code: string) => {
        const res = await (window as any).electronAPI.etf.delete(code)
        if (res.success) return { data: res.data, message: res.message }
        throw new Error(res.message || '删除失败')
    },

    quote: async (code: string) => {
        const res = await (window as any).electronAPI.etf.quote(code)
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取报价失败')
    },

    search: async (keyword: string) => {
        const res = await (window as any).electronAPI.etf.search(keyword)
        if (res.success) return { data: res.data }
        throw new Error(res.message || '搜索失败')
    },

    syncAll: async () => {
        const res = await (window as any).electronAPI.etf.syncAll()
        if (res.success) return { data: res.data, message: res.message }
        throw new Error(res.message || '同步失败')
    },

    syncHistory: async (startDate: string, endDate: string, codes?: string[], dataSource?: string) => {
        const params = toPlain({ startDate, endDate, codes, dataSource })
        const res = await (window as any).electronAPI.etf.syncHistory(params)
        if (res.success) return { data: res.data, message: res.message }
        throw new Error(res.message || '同步历史数据失败')
    },

    history: async (code: string, startDate: string, endDate: string) => {
        const res = await (window as any).electronAPI.etf.history(code, startDate, endDate)
        if (res.success) return { data: res.data, source: res.source }
        throw new Error(res.message || '获取历史数据失败')
    },

    marketList: async () => {
        const res = await (window as any).electronAPI.etf.marketList()
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取市场列表失败')
    }
}

// ==================== 配置相关接口 ====================
export const configApi = {
    getInitialRatios: async () => {
        const res = await (window as any).electronAPI.config.getInitialRatios()
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取初始配比失败')
    },

    updateInitialRatios: async (ratios: any) => {
        const res = await (window as any).electronAPI.config.updateInitialRatios(toPlain(ratios))
        if (res.success) return { data: res.data, message: res.message }
        throw new Error(res.message || '更新初始配比失败')
    },

    getStrategyA: async () => {
        const res = await (window as any).electronAPI.config.getStrategyA()
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取策略A配置失败')
    },

    updateStrategyA: async (config: any) => {
        const res = await (window as any).electronAPI.config.updateStrategyA(toPlain(config))
        if (res.success) return { data: res.data, message: res.message }
        throw new Error(res.message || '更新策略A配置失败')
    },

    getStrategyB: async () => {
        const res = await (window as any).electronAPI.config.getStrategyB()
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取策略B配置失败')
    },

    updateStrategyB: async (config: any) => {
        const res = await (window as any).electronAPI.config.updateStrategyB(toPlain(config))
        if (res.success) return { data: res.data, message: res.message }
        throw new Error(res.message || '更新策略B配置失败')
    },

    getEtfTypes: async () => {
        const res = await (window as any).electronAPI.config.getEtfTypes()
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取股票类型失败')
    }
}

// ==================== 回测相关接口 ====================
export const backtestApi = {
    run: async (params: any) => {
        const res = await (window as any).electronAPI.backtest.run(toPlain(params))
        if (res.success) return { data: res.data }
        throw new Error(res.message || '回测失败')
    },

    optimize: async (params: any) => {
        const res = await (window as any).electronAPI.backtest.optimize(toPlain(params))
        if (res.success) return { data: res.data }
        throw new Error(res.message || '参数寻优失败')
    },

    results: async () => {
        const res = await (window as any).electronAPI.backtest.results()
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取回测结果失败')
    },

    detail: async (id: number) => {
        const res = await (window as any).electronAPI.backtest.detail(id)
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取回测详情失败')
    }
}

// ==================== 交易记录相关接口 ====================
export const recordsApi = {
    trades: async (params?: any) => {
        const res = await (window as any).electronAPI.records.trades(toPlain(params))
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取交易记录失败')
    },

    market: async () => {
        const res = await (window as any).electronAPI.records.market()
        if (res.success) return { data: res.data }
        throw new Error(res.message || '获取市值信息失败')
    }
}

// ==================== XLS 历史数据导入 ====================
export const importXlsApi = {
    preview: async () => {
        return await (window as any).electronAPI.importXls.preview()
    },
    save: async (params: any) => {
        return await (window as any).electronAPI.importXls.save(toPlain(params))
    }
}

// ==================== 系统健康检查 ====================
export const healthCheck = async () => {
    return await (window as any).electronAPI.health()
}

export default { etfApi, configApi, backtestApi, recordsApi, importXlsApi, healthCheck }
