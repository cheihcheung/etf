/**
 * SQLite 版本的 Stock 模型
 */

class StockModel {
    constructor(db) {
        this.db = db;
        this.tableName = 'stock';
    }

    async query(sql, params = []) {
        return this.db.query(sql, params);
    }

    async queryOne(sql, params = []) {
        return this.db.queryOne(sql, params);
    }

    async execute(sql, params = []) {
        return this.db.execute(sql, params);
    }

    async find(id) {
        const sql = `SELECT * FROM ${this.tableName} WHERE id = ? LIMIT 1`;
        return this.db.queryOne(sql, [id]);
    }

    async findOne(where, params = []) {
        let sql = `SELECT * FROM ${this.tableName}`;
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

    async updateWhere(where, whereParams = [], data = {}) {
        const keys = Object.keys(data);
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        let sql = `UPDATE ${this.tableName} SET ${setClause}`;
        let actualParams = keys.map(k => data[k]);

        if (typeof where === 'object' && where !== null) {
            const whereKeys = Object.keys(where);
            const whereClause = whereKeys.map(k => `${k} = ?`).join(' AND ');
            sql += ` WHERE ${whereClause}`;
            actualParams = [...actualParams, ...whereKeys.map(k => where[k])];
        } else if (typeof where === 'string' && where.trim() !== '') {
            sql += ` WHERE ${where}`;
            actualParams = [...actualParams, ...whereParams];
        }

        return this.db.execute(sql, actualParams);
    }

    async delete(id) {
        const sql = `DELETE FROM ${this.tableName} WHERE id = ?`;
        return this.db.execute(sql, [id]);
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

    async getWithHistoryRange() {
        const sql = `
            SELECT b.*,
                   MIN(h.trade_date) AS history_start,
                   MAX(h.trade_date) AS history_end
            FROM stock b
            LEFT JOIN history_data h ON b.code = h.etf_code
            GROUP BY b.id
            ORDER BY b.asset_type, b.code
        `;
        return this.db.query(sql);
    }

    async updateRatio(code, ratio) {
        return this.updateWhere({ code }, [], { initial_ratio: ratio });
    }

    async syncPrice(code, price, changePct) {
        return this.updateWhere({ code }, [], {
            current_price: price,
            change_pct: changePct,
            update_time: new Date().toISOString()
        });
    }
}

module.exports = StockModel;