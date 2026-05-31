/**
 * ==========================================================
 * ETF多资产动态配置策略系统 - 极简轻量基类 ORM 数据模型 (BaseModel)
 * ==========================================================
 * 本类旨在为量化平台提供极易上手、类似于 ThinkPHP 特色的优雅 Model 封装。
 * 在不引入外部臃肿 ORM 的前提下，通过纯 JS 对象解析自动生成防 SQL 注入的 SQL 语句。
 * 全面支持一键 CRUD、条件查询与底层穿透，实现开发高内聚和 MVC 完美解耦。
 */
const db = require('../config/db');

class BaseModel {
    // 物理表名（子类覆盖）
    static tableName = '';
    // 表主键名（默认 id）
    static pk = 'id';

    /**
     * 底层 SELECT SQL 穿透查询
     * @param {string} sql 
     * @param {Array} params 
     */
    static async query(sql, params = []) {
        return await db.query(sql, params);
    }

    /**
     * 底层写操作 SQL 穿透执行
     * @param {string} sql 
     * @param {Array} params 
     */
    static async execute(sql, params = []) {
        return await db.execute(sql, params);
    }

    /**
     * 根据主键查询单条数据
     * @param {number|string} id 主键值
     * @returns {Promise<object|null>}
     */
    static async find(id) {
        const sql = `SELECT * FROM ${this.tableName} WHERE ${this.pk} = ? LIMIT 1`;
        return await db.queryOne(sql, [id]);
    }

    /**
     * 根据多条件/指定查询单条记录
     * @param {object|string} where 可以是对象 { code: '510300' } 或 SQL WHERE 片段
     * @param {Array} params 绑定的防注入参数数组
     * @returns {Promise<object|null>}
     */
    static async findOne(where, params = []) {
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
        return await db.queryOne(sql, actualParams);
    }

    /**
     * 通用多条件列表查询 (支持 ThinkPHP 风格的极简过滤)
     * @param {object|string|null} where 过滤条件对象或 WHERE SQL 字符串
     * @param {Array} params 参数数组
     * @param {string|null} orderBy 排序子句，例如 'trade_date DESC'
     * @param {number|string|null} limit 限制条数
     * @returns {Promise<Array>}
     */
    static async findAll(where = null, params = [], orderBy = null, limit = null) {
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

        return await db.query(sql, actualParams);
    }

    /**
     * 一键创建并插入单条记录 (ThinkPHP 风格自动键值解析)
     * @param {object} data 数据键值对，例如 { code: '510300', name: '300ETF' }
     * @returns {Promise<object>} 返回执行元数据，包含 insertId
     */
    static async create(data) {
        const keys = Object.keys(data);
        const placeholders = keys.map(() => '?').join(', ');
        const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
        const params = keys.map(k => data[k]);
        return await db.execute(sql, params);
    }

    /**
     * 一键根据主键 ID 更新记录 (极简链式)
     * @param {number|string} id 主键值
     * @param {object} data 要更新的字段数据，如 { current_price: 3.52 }
     * @returns {Promise<object>}
     */
    static async update(id, data) {
        const keys = Object.keys(data);
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE ${this.pk} = ?`;
        const params = [...keys.map(k => data[k]), id];
        return await db.execute(sql, params);
    }

    /**
     * 一键根据指定条件更新记录
     * @param {object|string} where 条件对象或 SQL 字符串
     * @param {Array} whereParams 条件对应的防注入绑定参数
     * @param {object} data 更新数据
     * @returns {Promise<object>}
     */
    static async updateWhere(where, whereParams = [], data = {}) {
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

        return await db.execute(sql, actualParams);
    }

    /**
     * 一键根据主键删除记录
     * @param {number|string} id 主键值
     * @returns {Promise<object>}
     */
    static async delete(id) {
        const sql = `DELETE FROM ${this.tableName} WHERE ${this.pk} = ?`;
        return await db.execute(sql, [id]);
    }

    /**
     * 一键根据条件删除记录
     * @param {object|string} where 条件对象或 SQL WHERE 片段
     * @param {Array} params 条件绑定的防注入参数数组
     * @returns {Promise<object>}
     */
    static async deleteWhere(where, params = []) {
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

        return await db.execute(sql, actualParams);
    }
}

module.exports = BaseModel;
