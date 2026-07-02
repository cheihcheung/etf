/**
 * ==========================================================================================
 * Electron IPC 处理器模块
 * ==========================================================================================
 * 将原有的 Express 路由转换为 Electron IPC handlers
 * 所有业务逻辑都在主进程中执行，通过 IPC 与渲染进程通信
 * ==========================================================================================
 */

// 导入 desktop 独立的爬虫与工具模块
const spider = require('./spider');
const { splitYears } = require('./utils');

// 导入数据库模型
const StockModel = require('./models/Stock');
const HistoryDataModel = require('./models/HistoryData');
const TradeRecordModel = require('./models/TradeRecord');
const StrategyAConfigModel = require('./models/StrategyAConfig');
const StrategyBConfigModel = require('./models/StrategyBConfig');

// 导入回测服务
const BacktestService = require('./services/backtest');

/**
 * 注册所有 IPC 处理器
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - SQLite 数据库实例
 */
function registerIpcHandlers(ipcMain, db) {
    // 初始化模型
    const Stock = new StockModel(db);
    const HistoryData = new HistoryDataModel(db);
    const TradeRecord = new TradeRecordModel(db);
    const StrategyAConfig = new StrategyAConfigModel(db);
    const StrategyBConfig = new StrategyBConfigModel(db);
    const Backtest = new BacktestService(db);

    // ==================== ETF 相关接口 ====================

    // 获取 ETF 列表
    ipcMain.handle('etf:list', async () => {
        try {
            const etfs = await Stock.getWithHistoryRange();
            return { success: true, data: sanitizeData(etfs) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 添加 ETF
    ipcMain.handle('etf:add', async (event, data) => {
        try {
            const { code, name, assetType, annualReturn, scaleFactor, isBenchmark } = data;
            if (!code || !name || !assetType) {
                return { success: false, message: '请填写完整的股票信息' };
            }

            const existing = await Stock.findOne({ code });
            if (existing) {
                return { success: false, message: '该股票已存在' };
            }

            if (isBenchmark === 1) {
                await Stock.updateWhere('1 = 1', [], { is_benchmark: 0 });
            }

            await Stock.create({
                code,
                name,
                asset_type: assetType,
                initial_ratio: 0.0000,
                annual_return: annualReturn != null ? parseFloat(annualReturn) : null,
                scale_factor: scaleFactor != null ? parseInt(scaleFactor) : 1,
                is_benchmark: isBenchmark === 1 ? 1 : 0
            });

            // 抓取实时行情
            const quote = await spider.fetchETFRealTimeQuote(code);
            if (quote) {
                await Stock.syncPrice(code, quote.currentPrice, quote.changePct);
            }

            return { success: true, message: '添加成功' };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 更新 ETF
    ipcMain.handle('etf:update', async (event, data) => {
        try {
            const { code, name, assetType, initialRatio, annualReturn, scaleFactor, isBenchmark } = data;

            if (isBenchmark === 1) {
                await Stock.updateWhere('1 = 1', [], { is_benchmark: 0 });
            }

            await Stock.updateWhere({ code }, [], {
                name: name,
                asset_type: assetType,
                initial_ratio: initialRatio !== undefined ? parseFloat(initialRatio) : 0.0000,
                annual_return: annualReturn != null ? parseFloat(annualReturn) : null,
                scale_factor: scaleFactor != null ? parseInt(scaleFactor) : 1,
                is_benchmark: isBenchmark === 1 ? 1 : 0
            });

            return { success: true, message: '更新成功' };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 删除 ETF
    ipcMain.handle('etf:delete', async (event, code) => {
        try {
            const ratioCheck = await Stock.findOne({ code });
            if (ratioCheck && parseFloat(ratioCheck.initial_ratio) > 0) {
                const allEtfs = await Stock.findAll();
                const otherTotal = allEtfs
                    .filter(e => e.code !== code)
                    .reduce((sum, e) => sum + parseFloat(e.initial_ratio || 0), 0);

                if (Math.abs(otherTotal - 100) > 0.01 && otherTotal > 0) {
                    return { success: false, message: '删除该股票会导致其他股票总占比不为100%，请先调整比例' };
                }
            }

            // 级联删除关联数据
            const HistoryData = new HistoryDataModel(db);
            const TradeRecord = new TradeRecordModel(db);
            await HistoryData.deleteWhere({ etf_code: code });
            await TradeRecord.deleteWhere({ etf_code: code });
            await Stock.deleteWhere({ code });

            return { success: true, message: '删除成功（含历史行情和交易记录）' };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 同步实时报价
    ipcMain.handle('etf:quote', async (event, code) => {
        try {
            const quote = await spider.fetchETFRealTimeQuote(code);
            if (quote) {
                await Stock.syncPrice(code, quote.currentPrice, quote.changePct);
            }
            return { success: true, data: sanitizeData(quote) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 搜索 ETF
    ipcMain.handle('etf:search', async (event, keyword) => {
        try {
            if (!keyword) {
                return { success: false, message: '请输入搜索关键词' };
            }
            const results = await spider.searchETF(keyword);
            return { success: true, data: sanitizeData(results) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 同步所有 ETF
    ipcMain.handle('etf:sync-all', async () => {
        try {
            const etfs = await Stock.findAll();
            if (etfs.length === 0) {
                return { success: false, message: '未找到股票数据，请先添加股票' };
            }
            let successCount = 0;
            let historySyncedCount = 0;
            const today = new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

            for (const etf of etfs) {
                try {
                    const quote = await spider.fetchETFRealTimeQuote(etf.code);
                    if (quote) {
                        await Stock.syncPrice(etf.code, quote.currentPrice, quote.changePct);
                        successCount++;
                    }
                } catch (quoteErr) {
                    // 单只ETF报价获取失败不影响其他
                }

                try {
                    const lastDate = await HistoryData.getLastRecordDate(etf.code);
                    // 如果没有历史数据，默认获取最近3年
                    let startDate;
                    if (lastDate) {
                        const lastDateObj = new Date(lastDate);
                        const nextDay = new Date(lastDateObj.getTime() + 24 * 3600 * 1000);
                        startDate = nextDay.toISOString().slice(0, 10);
                    } else {
                        const threeYearsAgo = new Date();
                        threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
                        startDate = threeYearsAgo.toISOString().slice(0, 10);
                    }

                    if (startDate <= today) {
                        const missingData = await spider.fetchETFHistoryData(etf.code, startDate, today);
                        if (missingData && missingData.length > 0) {
                            for (const row of missingData) {
                                const existingK = await HistoryData.findOne({
                                    etf_code: etf.code,
                                    trade_date: row.tradeDate
                                });
                                if (existingK) {
                                    await HistoryData.update(existingK.id, {
                                        close_price: row.closePrice
                                    });
                                } else {
                                    await HistoryData.create({
                                        etf_code: etf.code,
                                        trade_date: row.tradeDate,
                                        open_price: row.openPrice,
                                        close_price: row.closePrice,
                                        high_price: row.highPrice,
                                        low_price: row.lowPrice,
                                        volume: row.volume,
                                        change_pct: row.changePct
                                    });
                                }
                            }
                            historySyncedCount += missingData.length;
                        }
                    }
                } catch (histErr) {
                    // 单只ETF历史数据同步失败不影响其他
                }
            }

            return { success: true, message: `同步完成：${successCount}只股票实时价格已更新，自动补全了${historySyncedCount}条历史数据` };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 同步历史数据
    ipcMain.handle('etf:sync-history', async (event, params) => {
        try {
            const { startDate, endDate, codes } = params;
            if (!startDate || !endDate) {
                return { success: false, message: '请选择起止日期' };
            }

            let etfs;
            if (codes && codes.length > 0) {
                etfs = await Stock.findAll(`code IN (${codes.map(() => '?').join(', ')})`, codes);
            } else {
                etfs = await Stock.findAll();
            }

            if (etfs.length === 0) {
                return { success: false, message: '未找到匹配的股票数据，请先添加股票' };
            }

            let totalCount = 0;
            const segments = splitYears(startDate, endDate);

            for (const etf of etfs) {
                for (const seg of segments) {
                    let data;
                    try {
                        data = await spider.fetchETFHistoryData(etf.code, seg.start, seg.end);
                    } catch (fetchErr) {
                        continue;
                    }

                    if (data && data.length > 0) {
                        for (const row of data) {
                            const existingK = await HistoryData.findOne({
                                etf_code: etf.code,
                                trade_date: row.tradeDate
                            });

                            if (existingK) {
                                await HistoryData.update(existingK.id, {
                                    open_price: row.openPrice,
                                    close_price: row.closePrice,
                                    high_price: row.highPrice,
                                    low_price: row.lowPrice,
                                    volume: row.volume,
                                    change_pct: row.changePct
                                });
                            } else {
                                await HistoryData.create({
                                    etf_code: etf.code,
                                    trade_date: row.tradeDate,
                                    open_price: row.openPrice,
                                    close_price: row.closePrice,
                                    high_price: row.highPrice,
                                    low_price: row.lowPrice,
                                    volume: row.volume,
                                    change_pct: row.changePct
                                });
                            }
                        }
                        totalCount += data.length;
                    }
                }
            }

            return {
                success: true,
                message: `历史数据同步完成，共${totalCount}条`,
                data: { totalCount: Number(totalCount) }
            };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 获取历史数据
    ipcMain.handle('etf:history', async (event, code, startDate, endDate) => {
        try {
            if (!startDate || !endDate) {
                return { success: false, message: '请选择起止日期' };
            }

            const dbData = await HistoryData.getHistoryByRange(code, startDate, endDate);
            if (dbData.length > 0) {
                const data = dbData.map((r) => {
                    let tradeDate;
                    if (typeof r.trade_date === 'string') {
                        tradeDate = r.trade_date;
                    } else {
                        const d = new Date(r.trade_date);
                        tradeDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    }
                    return {
                        tradeDate,
                        openPrice: parseFloat(r.open_price),
                        closePrice: parseFloat(r.close_price),
                        highPrice: parseFloat(r.high_price),
                        lowPrice: parseFloat(r.low_price),
                        volume: parseInt(r.volume),
                        changePct: parseFloat(r.change_pct)
                    };
                });
                return { success: true, data: sanitizeData(data), source: 'db' };
            }

            const data = await spider.fetchETFHistoryData(code, startDate, endDate);
            return { success: true, data: sanitizeData(data), source: 'spider' };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 获取市场 ETF 列表
    ipcMain.handle('etf:market-list', async () => {
        try {
            const list = await spider.fetchETFList();
            return { success: true, data: sanitizeData(list) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // ==================== 配置相关接口 ====================

    // 获取初始配比
    ipcMain.handle('config:get-initial-ratios', async () => {
        try {
            const etfs = await Stock.findAll();
            const ratios = etfs.map(e => ({
                etfCode: e.code,
                name: e.name,
                ratio: parseFloat(e.initial_ratio || 0),
                isEnabled: e.is_enabled === null || e.is_enabled === undefined || e.is_enabled !== 0,
                stepRatio: parseFloat(e.step_ratio !== null && e.step_ratio !== undefined ? e.step_ratio : 5.0)
            }));
            return { success: true, data: sanitizeData(ratios) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 更新初始配比
    ipcMain.handle('config:update-initial-ratios', async (event, ratios) => {
        try {
            if (!ratios || ratios.length === 0) {
                return { success: false, message: '请配置股票比例' };
            }

            const activeTotal = ratios
                .filter(r => r.isEnabled !== false)
                .reduce((sum, r) => sum + parseFloat(r.ratio || 0), 0);

            if (activeTotal > 100.01) {
                return { success: false, message: `当前启用的资产总占比为${activeTotal.toFixed(2)}%，不能超过100%` };
            }

            await Stock.updateWhere('1 = 1', [], { initial_ratio: 0.0000 });
            for (const r of ratios) {
                await Stock.updateRatio(r.etfCode, r.isEnabled ? parseFloat(r.ratio) : 0);
                await Stock.updateWhere({ code: r.etfCode }, [], {
                    is_enabled: r.isEnabled ? 1 : 0,
                    step_ratio: parseFloat(r.stepRatio || 5.0)
                });
            }

            return { success: true, message: '比例保存成功' };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 获取策略 A 配置
    ipcMain.handle('config:get-strategy-a', async () => {
        try {
            const levels = await StrategyAConfig.findAll(null, [], 'level_order ASC');

            const drawdownLevels = levels
                .filter(l => l.trigger_type === 'drawdown')
                .map(l => ({
                    levelOrder: l.level_order,
                    threshold: parseFloat(l.threshold),
                    ratios: formatRatios(l.ratios)
                }));

            const rallyLevels = levels
                .filter(l => l.trigger_type === 'rally')
                .map(l => ({
                    levelOrder: l.level_order,
                    threshold: parseFloat(l.threshold),
                    ratios: formatRatios(l.ratios)
                }));

            return {
                success: true,
                data: sanitizeData({
                    enabled: true,
                    resetOnHigh: true,
                    drawdownLevels,
                    rallyLevels
                })
            };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 更新策略 A 配置
    ipcMain.handle('config:update-strategy-a', async (event, config) => {
        try {
            const { drawdownLevels, rallyLevels } = config;

            await db.transaction(() => {
                StrategyAConfig.deleteWhere('1 = 1');
                for (const l of (drawdownLevels || [])) {
                    StrategyAConfig.create({
                        trigger_type: 'drawdown',
                        level_order: l.levelOrder,
                        threshold: parseFloat(l.threshold),
                        ratios: parseToDbRatios(l.ratios)
                    });
                }
                for (const l of (rallyLevels || [])) {
                    StrategyAConfig.create({
                        trigger_type: 'rally',
                        level_order: l.levelOrder,
                        threshold: parseFloat(l.threshold),
                        ratios: parseToDbRatios(l.ratios)
                    });
                }
            });

            return { success: true, message: '策略A配置保存成功' };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 获取策略 B 配置
    ipcMain.handle('config:get-strategy-b', async () => {
        try {
            const levels = await StrategyBConfig.findAll(null, [], 'level_order ASC');

            const globalRow = levels.find(l => l.deviation_type === 'global_config');
            const centralAnnual = globalRow ? parseFloat(globalRow.threshold) : 10.0;

            const overvaluedLevels = levels
                .filter(l => l.deviation_type === 'overvalued')
                .map(l => ({
                    levelOrder: l.level_order,
                    threshold: parseFloat(l.threshold),
                    ratios: formatRatios(l.ratios)
                }));

            const undervaluedLevels = levels
                .filter(l => l.deviation_type === 'undervalued')
                .map(l => ({
                    levelOrder: l.level_order,
                    threshold: parseFloat(l.threshold),
                    ratios: formatRatios(l.ratios)
                }));

            return {
                success: true,
                data: sanitizeData({
                    enabled: true,
                    centralAnnual,
                    overvaluedLevels,
                    undervaluedLevels
                })
            };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 更新策略 B 配置
    ipcMain.handle('config:update-strategy-b', async (event, config) => {
        try {
            const { overvaluedLevels, undervaluedLevels, centralAnnual } = config;

            await db.transaction(() => {
                StrategyBConfig.deleteWhere('1 = 1');
                StrategyBConfig.create({
                    deviation_type: 'global_config',
                    level_order: 0,
                    threshold: parseFloat(centralAnnual || 10.0),
                    ratios: '{}'
                });
                for (const l of (overvaluedLevels || [])) {
                    StrategyBConfig.create({
                        deviation_type: 'overvalued',
                        level_order: l.levelOrder,
                        threshold: parseFloat(l.threshold),
                        ratios: parseToDbRatios(l.ratios)
                    });
                }
                for (const l of (undervaluedLevels || [])) {
                    StrategyBConfig.create({
                        deviation_type: 'undervalued',
                        level_order: l.levelOrder,
                        threshold: parseFloat(l.threshold),
                        ratios: parseToDbRatios(l.ratios)
                    });
                }
            });

            return { success: true, message: '策略B配置保存成功' };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 获取 ETF 类型
    ipcMain.handle('config:get-etf-types', async () => {
        try {
            const etfs = await Stock.findAll();
            const existingTypes = etfs.map(e => e.asset_type).filter(Boolean);
            const defaultTypes = ['股票类', '债券类', '红利类', '商品类', '黄金类', '指数类'];
            const allTypes = [...new Set([...defaultTypes, ...existingTypes])];
            return { success: true, data: sanitizeData(allTypes) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // ==================== 回测相关接口 ====================

    // 执行回测
    ipcMain.handle('backtest:run', async (event, params) => {
        try {
            const result = await Backtest.runBacktest(params);
            if (result.error) {
                return { success: false, message: String(result.error) };
            }
            return { success: true, data: sanitizeData(result) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 参数寻优
    ipcMain.handle('backtest:optimize', async (event, params) => {
        try {
            const result = await Backtest.runParameterOptimization(params);
            return { success: true, data: sanitizeData(result) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 获取回测结果
    ipcMain.handle('backtest:results', async () => {
        try {
            const results = await Backtest.getBacktestResults();
            return { success: true, data: sanitizeData(results) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 获取回测详情
    ipcMain.handle('backtest:detail', async (event, id) => {
        try {
            const detail = await Backtest.getBacktestDetail(id);
            if (!detail) {
                return { success: false, message: '回测结果不存在' };
            }
            return { success: true, data: sanitizeData(detail) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // ==================== 交易记录相关接口 ====================

    // 获取交易记录
    ipcMain.handle('records:trades', async (event, params) => {
        try {
            const { type, startDate, endDate, page = 1, pageSize = 50 } = params;

            const conditions = [];
            const queryParams = [];

            if (type) {
                conditions.push('trade_type = ?');
                queryParams.push(type);
            }
            if (startDate) {
                conditions.push('trade_time >= ?');
                queryParams.push(startDate);
            }
            if (endDate) {
                conditions.push('trade_time <= ?');
                queryParams.push(endDate + ' 23:59:59');
            }

            const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1 = 1';
            const limit = parseInt(pageSize);
            const offset = (parseInt(page) - 1) * limit;

            const records = await TradeRecord.findAll(
                whereClause,
                queryParams,
                'trade_time DESC',
                `${limit} OFFSET ${offset}`
            );

            return { success: true, data: sanitizeData(records) };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // 获取市值
    ipcMain.handle('records:market', async () => {
        try {
            const hs300 = await spider.fetchHS300Index();
            return {
                success: true,
                data: sanitizeData({
                    hs300,
                })
            };
        } catch (error) {
            return { success: false, message: getErrorMessage(error) };
        }
    });

    // ==================== 健康检查 ====================
    ipcMain.handle('health', async () => {
        return { status: 'ok', time: new Date().toISOString() };
    });

    // ==================== XLS 历史数据导入 ====================

    /**
     * 解析同花顺导出的 xls 数据行
     * 使用 header:1 原始数组格式，按位置索引解析（兼容编码导致的中文列名乱码问题）
     * 同花顺标准列顺序: 时间,名称,开盘,收盘,最高,最低,涨跌,涨跌幅%,振幅%,成交量(手),成交额(元)
     */
    function parseXlsRows(filePath) {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        // 跳过标题行，从第2行开始（索引1）
        const dataRows = rawRows.slice(1).filter(row => {
            const dateVal = row[0];
            const closeVal = row[4] !== null && row[4] !== undefined && row[4] !== '';
            return dateVal && closeVal;
        });

        return dataRows.map((row, idx) => {
            // 列位置：0=时间, 1=开盘, 2=最高, 3=最低, 4=收盘, 5=涨跌, 6=涨跌幅%, 7=振幅%, 8=成交量, 9=成交额
            let dateVal = row[0] ? String(row[0]).trim() : '';
            // 清理日期格式，"2005-01-04,二" → "2005-01-04"
            dateVal = dateVal.replace(/,.*$/, '');
            // Excel 日期序列号处理
            if (/^\d+$/.test(dateVal) && parseInt(dateVal) > 40000) {
                const d = new Date((parseInt(dateVal) - 25569) * 86400 * 1000);
                dateVal = d.toISOString().slice(0, 10);
            }

            return {
                _index: idx + 1,
                trade_date: dateVal,
                open_price: parseFloat(row[1]) || 0,
                close_price: parseFloat(row[4]) || 0,
                high_price: parseFloat(row[2]) || 0,
                low_price: parseFloat(row[3]) || 0,
                change_pct: parseFloat(row[6]) || 0,
                volume: parseInt(String(row[8] || '0').replace(/[,，]/g, '')) || 0
            };
        });
    }

    // 选择并解析 xls 文件，返回预览数据
    ipcMain.handle('import:xls-preview', async () => {
        const { dialog } = require('electron');
        try {
            const result = await dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [{ name: 'Excel 文件', extensions: ['xls', 'xlsx'] }]
            });

            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, canceled: true };
            }

            const filePath = result.filePaths[0];
            const preview = parseXlsRows(filePath);

            return {
                success: true,
                data: {
                    filePath,
                    totalRows: preview.length,
                    preview: preview.slice(0, 20)
                }
            };
        } catch (error) {
            return { success: false, message: '解析文件失败: ' + getErrorMessage(error) };
        }
    });

    // 保存解析后的 xls 数据到数据库
    ipcMain.handle('import:xls-save', async (event, { etfCode, filePath }) => {
        const HistoryData = new HistoryDataModel(db);
        try {
            const dataRows = parseXlsRows(filePath);

            let insertCount = 0;
            let updateCount = 0;

            for (const row of dataRows) {
                if (!row.trade_date || row.close_price <= 0) continue;

                const existing = await HistoryData.findOne({ etf_code: etfCode, trade_date: row.trade_date });

                if (existing) {
                    await HistoryData.update(existing.id, {
                        open_price: row.open_price,
                        close_price: row.close_price,
                        high_price: row.high_price,
                        low_price: row.low_price,
                        volume: row.volume,
                        change_pct: row.change_pct
                    });
                    updateCount++;
                } else {
                    await HistoryData.create({
                        etf_code: etfCode,
                        trade_date: row.trade_date,
                        open_price: row.open_price,
                        close_price: row.close_price,
                        high_price: row.high_price,
                        low_price: row.low_price,
                        volume: row.volume,
                        change_pct: row.change_pct
                    });
                    insertCount++;
                }
            }

            return { success: true, message: `导入完成：新增 ${insertCount} 条，更新 ${updateCount} 条`, data: { insertCount, updateCount } };
        } catch (error) {
            return { success: false, message: '导入失败: ' + getErrorMessage(error) };
        }
    });
}

// ==================== 辅助函数 ====================

/**
 * 清理数据，确保可以通过 Electron IPC 传递
 * 使用 JSON 序列化/反序列化移除所有不可序列化的对象
 * 包括 Buffer、Date、Error、循环引用、better-sqlite3 对象等
 */
function sanitizeData(data) {
    if (data === null || data === undefined) {
        return data;
    }
    try {
        return JSON.parse(JSON.stringify(data));
    } catch {
        return null;
    }
}

/**
 * 提取错误消息，确保返回纯字符串
 */
function getErrorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error.message) return String(error.message);
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

/**
 * JSON比率转换助手
 */
function formatRatios(ratiosJson) {
    const parsed = typeof ratiosJson === 'string' ? JSON.parse(ratiosJson) : (ratiosJson || {});
    return Object.keys(parsed).map(code => ({
        etfCode: code,
        targetRatio: parseFloat(parsed[code])
    }));
}

function parseToDbRatios(ratiosArr) {
    const ratiosObj = {};
    (ratiosArr || []).forEach(r => {
        ratiosObj[r.etfCode] = parseFloat(r.targetRatio || 0);
    });
    return JSON.stringify(ratiosObj);
}

module.exports = { registerIpcHandlers };