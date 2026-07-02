/**
 * ==========================================================================================
 * XLS 历史数据导入路由（web 版）
 * ==========================================================================================
 * 同花顺导出的 xls 文件，通过 multer 上传到服务器，用 xlsx 库解析后写入 MySQL
 * 列顺序（同花顺标准）：时间,名称,开盘,收盘,最高,最低,涨跌,涨跌幅%,振幅%,成交量(手),成交额(元)
 * ==========================================================================================
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const HistoryData = require('../models/HistoryData');

// 确保上传目录存在
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// multer 配置：单文件上传，保留原扩展名
const upload = multer({
    dest: UPLOAD_DIR,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 限制
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xls' || ext === '.xlsx') {
            cb(null, true);
        } else {
            cb(new Error('仅支持 .xls / .xlsx 文件'));
        }
    }
});

/**
 * 解析同花顺导出的 xls 数据行
 * 使用 header:1 原始数组格式，按位置索引解析（兼容编码导致的中文列名乱码问题）
 */
function parseXlsRows(filePath) {
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

/**
 * POST /api/import/xls-preview
 * 上传 xls 文件，解析并返回预览数据（前20行）
 */
router.post('/xls-preview', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: '请选择文件' });
        }

        const filePath = req.file.path;
        const preview = parseXlsRows(filePath);

        // 返回预览数据（包含文件路径，后续保存时使用）
        return res.json({
            success: true,
            data: {
                filePath,
                fileName: req.file.originalname,
                totalRows: preview.length,
                preview: preview.slice(0, 20)
            }
        });
    } catch (error) {
        return res.json({ success: false, message: '解析文件失败: ' + (error.message || error) });
    }
});

/**
 * POST /api/import/xls-save
 * 将已解析的 xls 数据保存到数据库
 * body: { etfCode, filePath }
 */
router.post('/xls-save', async (req, res) => {
    const { etfCode, filePath } = req.body;
    if (!etfCode || !filePath) {
        return res.json({ success: false, message: '参数不完整' });
    }

    try {
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.json({ success: false, message: '文件不存在，请重新上传' });
        }

        const dataRows = parseXlsRows(filePath);

        let insertCount = 0;
        let updateCount = 0;

        for (const row of dataRows) {
            if (!row.trade_date || row.close_price <= 0) continue;

            // 检查是否已存在
            const existing = await HistoryData.findOne({
                etf_code: etfCode,
                trade_date: row.trade_date
            });

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

        // 清理临时文件
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }

        return res.json({
            success: true,
            message: `导入完成：新增 ${insertCount} 条，更新 ${updateCount} 条`,
            data: { insertCount, updateCount }
        });
    } catch (error) {
        return res.json({ success: false, message: '导入失败: ' + (error.message || error) });
    }
});

module.exports = router;
