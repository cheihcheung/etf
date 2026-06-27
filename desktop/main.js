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

const { app, BrowserWindow, ipcMain, Menu, protocol, net } = require('electron');
const path = require('path');
const Database = require('./src/database');
const { registerIpcHandlers } = require('./src/ipc-handlers');

// 开发环境判断
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let db;

// ========== 注册自定义协议，解决 file:// 下 ES Module 无法加载的问题 ==========
// 生产环境使用 app:// 协议加载前端资源，绕过 file:// 的 CORS 限制
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app',
        privileges: {
            secure: true,
            standard: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }
]);

/**
 * 获取前端静态文件根目录
 */
function getFrontendBasePath() {
    return isDev
        ? path.join(__dirname, 'client/dist')
        : path.join(process.resourcesPath, 'client/dist');
}

/**
 * 创建主窗口
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        title: 'ETF策略系统'
    });

    // 移除应用菜单
    Menu.setApplicationMenu(null);

    // F12 / Ctrl+Shift+I 打开 DevTools
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
            mainWindow.webContents.toggleDevTools();
        }
    });

    // 加载页面
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadURL('app://./index.html');
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
        // 生产环境注册 app:// 协议的文件拦截器
        if (!isDev) {
            const frontendBase = getFrontendBasePath();
            protocol.handle('app', (request) => {
                const urlPath = new URL(request.url).pathname;
                const filePath = path.join(frontendBase, urlPath);
                return net.fetch('file://' + filePath);
            });
        }

        // 初始化数据库
        const dbPath = isDev
            ? path.join(__dirname, 'data/etf.db')
            : path.join(app.getPath('userData'), 'etf.db');

        db = new Database(dbPath);
        await db.initialize();

        // 注册 IPC 处理器
        registerIpcHandlers(ipcMain, db);

        // 创建窗口
        createWindow();
    } catch (error) {
        console.error('初始化失败:', error);
        app.quit();
    }
}

// 应用就绪
app.whenReady().then(initializeApp);

// 所有窗口关闭时退出
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
