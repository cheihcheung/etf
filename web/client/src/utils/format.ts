/**
 * ==========================================================
 * 多资产策略回测系统 - 前端公共工具函数模块 (Format Utils)
 * ==========================================================
 * 本模块提供全系统统一的日期时间、百分比、货币及数值转换的优雅工具函数，
 * 提升页面组件的整洁度与二次开发维护性。
 *
 * 【函数清单】
 *   formatDateTime(val)   — 完整日期时间 → "YYYY-MM-DD HH:mm:ss"
 *   formatDate(val)       — 仅日期       → "YYYY-MM-DD"
 *   getTodayString()      — 获取北京时间当天日期字符串
 *   formatPercent(val)   — 百分比格式化  → "12.35%"
 *   formatMoney(val)     — 金额千分位    → "1,000,000.00"
 *
 * 【时区说明】
 *   getTodayString() 使用 UTC+8 时区偏移（8小时），确保北京时间日期正确。
 *   其他格式化函数依赖浏览器原生 Date 解析，注意后端返回的 ISO 时间可能是 UTC。
 */

/**
 * 格式化完整的日期时间字符串，去除 'T' 和毫秒后缀
 * 例如: "2026-05-17T03:46:01.000Z" -> "2026-05-17 03:46:01"
 * @param val 日期时间字符串或 Date 对象
 * @returns 格式化后的字符串，如无效则返回 "-"
 */
export function formatDateTime(val: string | Date | null | undefined): string {
    if (!val) return '-'
    
    // 如果是纯字符串且不含 T/Z，可能是后端已经格式化好的本地时间，直接返回
    if (typeof val === 'string' && !val.includes('T') && !val.includes('Z')) {
        return val
    }
    
    const d = typeof val === 'string' ? new Date(val) : val
    if (isNaN(d.getTime())) return '-'
    
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const date = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const seconds = String(d.getSeconds()).padStart(2, '0')
    
    return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`
}

/**
 * 格式化短日期字符串，只保留年月日
 * 例如: "2026-05-17T03:46:01.000Z" -> "2026-05-17"
 * @param val 日期时间
 * @returns YYYY-MM-DD 格式字符串
 */
export function formatDate(val: string | Date | null | undefined): string {
    if (!val) return '-'
    
    // 如果是 String 类型，且可能是包含 T 的 ISO 格式字符串
    if (typeof val === 'string' && val.includes('T')) {
        const d = new Date(val)
        if (!isNaN(d.getTime())) {
            const year = d.getFullYear()
            const month = String(d.getMonth() + 1).padStart(2, '0')
            const date = String(d.getDate()).padStart(2, '0')
            return `${year}-${month}-${date}`
        }
    }
    
    // 如果是 Date 对象
    if (val instanceof Date) {
        const year = val.getFullYear()
        const month = String(val.getMonth() + 1).padStart(2, '0')
        const date = String(val.getDate()).padStart(2, '0')
        return `${year}-${month}-${date}`
    }
    
    // 否则直接截取前10位返回即可
    return typeof val === 'string' ? val.slice(0, 10) : '-'
}

/**
 * 获取当前的北京时间日期字符串 (时区对齐)
 * @returns YYYY-MM-DD
 */
export function getTodayString(): string {
    const d = new Date(new Date().getTime() + 8 * 3600 * 1000)
    return d.toISOString().slice(0, 10)
}

/**
 * 格式化百分比数值并补足小数位
 * 例如: 12.345 -> "12.35%"
 * @param val 百分比数值
 * @param precision 保留的小数位数，默认 2 位
 * @returns 格式化后的百分比字符串
 */
export function formatPercent(val: number | string | null | undefined, precision = 2): string {
    if (val === null || val === undefined || val === '') return '-'
    const num = typeof val === 'number' ? val : parseFloat(val)
    if (isNaN(num)) return '-'
    return num.toFixed(precision) + '%'
}

/**
 * 格式化货币/金额数值，加入千分位分隔符
 * 例如: 1000000 -> "1,000,000.00"
 * @param val 金额数值
 * @param precision 小数位数，默认 2 位
 * @returns 格式化后的金额字符串
 */
export function formatMoney(val: number | string | null | undefined, precision = 2): string {
    if (val === null || val === undefined || val === '') return '-'
    const num = typeof val === 'number' ? val : parseFloat(val)
    if (isNaN(num)) return '-'
    return num.toFixed(precision).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
