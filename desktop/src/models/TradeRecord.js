/**
 * SQLite 版本的 TradeRecord 模型
 */

class TradeRecordModel {
    constructor(db) {
        this.db = db;
        this.tableName = 'trade_records';
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

    async logTrade(tradeData) {
        return this.create({
            trade_time: tradeData.tradeTime || new Date().toISOString(),
            trade_type: tradeData.tradeType,
            etf_code: tradeData.etfCode,
            trade_direction: tradeData.tradeDirection,
            shares: tradeData.shares,
            price: tradeData.price,
            amount: tradeData.amount,
            fee: tradeData.fee || 0,
            before_ratio: tradeData.beforeRatio,
            after_ratio: tradeData.afterRatio,
            reason: tradeData.reason,
            trigger_detail: tradeData.triggerDetail ? JSON.stringify(tradeData.triggerDetail) : null
        });
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
}

module.exports = TradeRecordModel;