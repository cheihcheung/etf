/**
 * SQLite 版本的 HistoryData 模型
 */

class HistoryDataModel {
    constructor(db) {
        this.db = db;
        this.tableName = 'history_data';
    }

    async findOne(where, params = []) {
        let sql = `SELECT * FROM ${this.tableName}`;
        let actualParams = [];

        if (typeof where === 'object' && where !== null) {
            const keys = Object.keys(where);
            const whereClause = keys.map(k => `${k} = ?`).join(' AND ');
            sql += ` WHERE ${whereClause}`;
            actualParams = keys.map(k => where[k]);
        } else if (typeof where === 'string') {
            sql += ` WHERE ${where}`;
            actualParams = params;
        }

        sql += ' LIMIT 1';
        return this.db.queryOne(sql, actualParams);
    }

    async findAll(where = null, params = [], orderBy = null, limit = null) {
        let sql = `SELECT * FROM ${this.tableName}`;
        let actualParams = [];

        if (where) {
            if (typeof where === 'object') {
                const keys = Object.keys(where);
                const whereClause = keys.map(k => `${k} = ?`).join(' AND ');
                sql += ` WHERE ${whereClause}`;
                actualParams = keys.map(k => where[k]);
            } else if (typeof where === 'string') {
                sql += ` WHERE ${where}`;
                actualParams = params;
            }
        }

        if (orderBy) {
            sql += ` ORDER BY ${orderBy}`;
        }

        if (limit) {
            sql += ` LIMIT ${limit}`;
        }

        return this.db.query(sql, actualParams);
    }

    async create(data) {
        const keys = Object.keys(data);
        const placeholders = keys.map(() => '?').join(', ');
        const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
        const params = keys.map(k => data[k]);
        return this.db.execute(sql, params);
    }

    async update(id, data) {
        const keys = Object.keys(data);
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`;
        const params = [...keys.map(k => data[k]), id];
        return this.db.execute(sql, params);
    }

    async deleteWhere(where, params = []) {
        let sql = `DELETE FROM ${this.tableName}`;
        let actualParams = [];

        if (typeof where === 'object' && where !== null) {
            const keys = Object.keys(where);
            const whereClause = keys.map(k => `${k} = ?`).join(' AND ');
            sql += ` WHERE ${whereClause}`;
            actualParams = keys.map(k => where[k]);
        } else if (typeof where === 'string' && where.trim() !== '') {
            sql += ` WHERE ${where}`;
            actualParams = params;
        }

        return this.db.execute(sql, actualParams);
    }

    async bulkUpsert(records) {
        if (!records || records.length === 0) return 0;
        const sql = `
            INSERT INTO ${this.tableName} (etf_code, trade_date, open_price, close_price, high_price, low_price, volume, change_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(etf_code, trade_date) DO UPDATE SET
                open_price = excluded.open_price,
                close_price = excluded.close_price,
                high_price = excluded.high_price,
                low_price = excluded.low_price,
                volume = excluded.volume,
                change_pct = excluded.change_pct
        `;
        const insertStmt = this.db.db.prepare(sql);
        return this.db.transaction(() => {
            let count = 0;
            for (const r of records) {
                insertStmt.run(
                    r.etf_code || r.etfCode,
                    r.trade_date || r.tradeDate,
                    r.open_price ?? r.openPrice ?? r.close_price ?? r.closePrice,
                    r.close_price ?? r.closePrice,
                    r.high_price ?? r.highPrice ?? r.close_price ?? r.closePrice,
                    r.low_price ?? r.lowPrice ?? r.close_price ?? r.closePrice,
                    r.volume || 0,
                    r.change_pct ?? r.changePct ?? 0
                );
                count++;
            }
            return count;
        });
    }

    async getHistoryByRange(etfCode, startDate, endDate) {
        const sql = `
            SELECT * FROM ${this.tableName}
            WHERE etf_code = ? AND trade_date >= ? AND trade_date <= ?
            ORDER BY trade_date ASC
        `;
        return this.db.query(sql, [etfCode, startDate, endDate]);
    }

    async getLastRecordDate(etfCode) {
        const sql = `
            SELECT MAX(trade_date) as last_date
            FROM ${this.tableName}
            WHERE etf_code = ?
        `;
        const result = this.db.queryOne(sql, [etfCode]);
        return result ? result.last_date : null;
    }
}

module.exports = HistoryDataModel;