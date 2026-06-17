import { request } from '@/utils'

export const etfApi = {
    list: () => request.get('/etf/list'),
    add: (data: { code: string; name: string; assetType: string; annualReturn?: number | null; scaleFactor?: number }) => request.post('/etf/add', data),
    update: (data: { code: string; name: string; assetType: string; annualReturn?: number | null; scaleFactor?: number }) => request.put('/etf/update', data),
    delete: (code: string) => request.delete(`/etf/delete/${code}`),
    quote: (code: string) => request.get(`/etf/quote/${code}`),
    search: (keyword: string) => request.get('/etf/search', { params: { keyword } }),
    syncAll: () => request.post('/etf/sync-all'),
    syncHistory: (startDate: string, endDate: string, codes?: string[]) => request.post('/etf/sync-history', { startDate, endDate, codes }),
    history: (code: string, startDate: string, endDate: string) =>request.get(`/etf/history/${code}`, { params: { startDate, endDate } }),
    marketList: () => request.get('/etf/market-list'),
}

export const configApi = {
    getInitialRatios: () => request.get('/config/initial-ratios'),
    updateInitialRatios: (ratios: { etfCode: string; ratio: number }[]) =>request.put('/config/initial-ratios', { ratios }),
    getStrategyA: () => request.get('/config/strategy-a'),
    updateStrategyA: (config: any) => request.put('/config/strategy-a', config),
    getStrategyB: () => request.get('/config/strategy-b'),
    updateStrategyB: (config: any) => request.put('/config/strategy-b', config),
    getEtfTypes: () => request.get('/config/etf-types'),
}


export const backtestApi = {
    run: (params: any) => request.post('/backtest/run', params),
    optimize: (params: any) => request.post('/backtest/optimize', params),
    results: () => request.get('/backtest/results'),
    detail: (id: number) => request.get(`/backtest/results/${id}`),
}

export const recordsApi = {
    trades: (params?: { type?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) =>request.get('/records/trades', { params }),
    market: () => request.get('/records/market'),
}

export default request
