/**
 * ==========================================================================================
 * Electron Preload Script
 * ==========================================================================================
 * 安全地将主进程的 IPC API 暴露给渲染进程
 * 使用 contextBridge 确保安全性
 * ==========================================================================================
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 将参数转换为纯 JSON 对象
 * 解决 Vue 3 响应式对象（Proxy）无法被 Electron IPC 序列化的问题
 */
function toPlain(data) {
    if (data === null || data === undefined) {
        return data;
    }
    try {
        return JSON.parse(JSON.stringify(data));
    } catch {
        return data;
    }
}

// 暴露 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
    // ETF 相关接口
    etf: {
        list: () => ipcRenderer.invoke('etf:list'),
        add: (data) => ipcRenderer.invoke('etf:add', toPlain(data)),
        update: (data) => ipcRenderer.invoke('etf:update', toPlain(data)),
        delete: (code) => ipcRenderer.invoke('etf:delete', code),
        quote: (code) => ipcRenderer.invoke('etf:quote', code),
        search: (keyword) => ipcRenderer.invoke('etf:search', keyword),
        syncAll: () => ipcRenderer.invoke('etf:sync-all'),
        syncHistory: (params) => ipcRenderer.invoke('etf:sync-history', toPlain(params)),
        history: (code, startDate, endDate) => ipcRenderer.invoke('etf:history', code, startDate, endDate),
        marketList: () => ipcRenderer.invoke('etf:market-list')
    },

    // 配置相关接口
    config: {
        getInitialRatios: () => ipcRenderer.invoke('config:get-initial-ratios'),
        updateInitialRatios: (ratios) => ipcRenderer.invoke('config:update-initial-ratios', toPlain(ratios)),
        getStrategyA: () => ipcRenderer.invoke('config:get-strategy-a'),
        updateStrategyA: (config) => ipcRenderer.invoke('config:update-strategy-a', toPlain(config)),
        getStrategyB: () => ipcRenderer.invoke('config:get-strategy-b'),
        updateStrategyB: (config) => ipcRenderer.invoke('config:update-strategy-b', toPlain(config)),
        getEtfTypes: () => ipcRenderer.invoke('config:get-etf-types')
    },

    // 回测相关接口
    backtest: {
        run: (params) => ipcRenderer.invoke('backtest:run', toPlain(params)),
        optimize: (params) => ipcRenderer.invoke('backtest:optimize', toPlain(params)),
        results: () => ipcRenderer.invoke('backtest:results'),
        detail: (id) => ipcRenderer.invoke('backtest:detail', id)
    },

    // 交易记录相关接口
    records: {
        trades: (params) => ipcRenderer.invoke('records:trades', toPlain(params)),
        market: () => ipcRenderer.invoke('records:market')
    },

    // 健康检查
    health: () => ipcRenderer.invoke('health')
});
