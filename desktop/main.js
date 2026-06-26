/**
 * ==========================================================================================
 * ETF 多资产动态配置策略系统 —— Electron 主进程入口
 * ==========================================================================================
 * 职责：
 *   1. 创建应用窗口，加载前端页面
 *   2. 初始化 SQLite 数据库
 *   3. 注册 IPC 处理器，响应渲染进程请求
 *   4. 处理应用生命周期事件
 * ==========================================================================================
 */

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const Database = require('./database');
const { registerIpcHandlers } = require('./ipc-handlers');

// 开发环境判断
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let db;

/**
 * 创建主窗口
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        autoHideMenuBar: true, // 隐藏系统菜单栏
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        title: 'ETF策略系统'
    });

    // 移除应用菜单（彻底关闭系统菜单）
    Menu.setApplicationMenu(null);

    // 开发环境加载 Vite 开发服务器
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        // 生产环境加载打包后的静态文件（client/dist 由 extraResources 复制到 resources 目录）
        mainWindow.loadFile(path.join(process.resourcesPath, 'client/dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * 应用初始化
 */
async function initializeApp() {
    try {
        // 初始化数据库
        const dbPath = isDev
            ? path.join(__dirname, 'data/etf.db')
            : path.join(app.getPath('userData'), 'etf.db');

        db = new Database(dbPath);
        await db.initialize();
        console.log('[DB] SQLite 数据库初始化成功');

        // 注册 IPC 处理器
        registerIpcHandlers(ipcMain, db);
        console.log('[IPC] IPC 处理器注册成功');

        // 创建窗口
        createWindow();
    } catch (error) {
        console.error('[App] 初始化失败:', error);
        app.quit();
    }
}

// 应用就绪
app.whenReady().then(initializeApp);

// 所有窗口关闭时退出（macOS 除外）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// macOS 激活应用时重新创建窗口
app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// 应用退出前清理
app.on('before-quit', () => {
    if (db) {
        db.close();
    }
});