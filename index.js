var debug = require('debug')('pg-bricks');
var pf = require('point-free');
var sql = require('sql-bricks-postgres');
var pg = require('pg');
// HACK: when using NODE_PG_FORCE_NATIVE pg.Query is inaccessible
var Query = pg.Query || require('pg/lib/query');


function _expectRow(res, callback) {
    if (res.rows.length === 0)
        return callback(new Error('Expected a row, none found'), res);
    if (res.rows.length > 1)
        return callback(new Error('Expected a single row, multiple found'), res);
    return callback(null, res)
}

function _expectCol(res, callback) {
    if (res.fields.length === 0)
        return callback(new Error('Expected a column, none found'), res);
    if (res.fields.length > 1)
        return callback(new Error('Expected a single column, multiple found'), res);
    return callback(null, res)
}

var Accessors = {
    rows: function (res, callback) {
        callback(null, res.rows)
    },
    row: pf.waterfall(
        _expectRow,
        function (res, callback) { callback(null, res.rows[0]) }
    ),
    col: pf.waterfall(
        _expectCol,
        function (res, callback) {
            var field = res.fields[0].name;
            callback(null, res.rows.map(function (row) { return row[field] }));
        }
    ),
    val: pf.waterfall(
        _expectRow,
        _expectCol,
        function (res, callback) {
            var field = res.fields[0].name;
            callback(null, res.rows[0][field]);
        }
    )
}


function RawSQL(text, values) {
    return {
        toParams: function () {
            return {text: text, values: values || []}
        }
    }
}

function toOptionalPromise(func) {
    return function (callback) {
        if (callback) return func(callback);

        return new Promise(function (resolve, reject) {
            func(function (err, res) {
                if (err) reject(err)
                else resolve(res)
            })
        })
    }
}

function instrument(client) {
    // Monkey patch statement constructors to pg client and make them runnable
    ['select', 'insert', 'update', 'delete', 'raw'].forEach(function (statement) {
        client[statement] = function () {
            var brick = statement == 'raw' ? RawSQL.apply(this, arguments)
                                           : sql[statement].apply(sql, arguments);

            brick.run = function (callback) {
                var config = brick.toParams();
                return this.query(config.text, config.values, callback);
                debug('%s %o', config.text, config.values);
            }.bind(this);

            // Bind accessors
            brick.rows = toOptionalPromise(pf.waterfall(brick.run, Accessors.rows));
            brick.row  = toOptionalPromise(pf.waterfall(brick.run, Accessors.row));
            brick.col  = toOptionalPromise(pf.waterfall(brick.run, Accessors.col));
            brick.val  = toOptionalPromise(pf.waterfall(brick.run, Accessors.val));

            // Patch insert().select()
            if (statement == 'insert') {
                brick.select = function select() {
                    var select = sql.insert.prototype.select.apply(this, arguments);
                    ['run', 'rows', 'row', 'col', 'val'].forEach(function (method) {
                        select[method] = brick[method];
                    })
                    return select;
                }
            }

            return brick;
        }
    })
}

function instrumentQuery(query) {
    query.pipe = function (dest) {
        query.on('error', dest.emit.bind(dest, 'error'));
        query.on('row', function (row) {
            dest.write(row);
        });
        query.on('end', function (res) {
            dest.end();
        });
        return dest;
    }
    return query;
}


// A Conf object
function Conf(config, _pg) {
    if (typeof config === 'string') config = {connectionString: config};
    this._config = config;
    this._pg = _pg || pg;
    this._pool = this._pg.Pool(config);
}

Conf.prototype = {
    sql: sql,
    pg: pg,

    get native () {
        return new Conf(this._connStr, pg.native);
    },

    query: function (query, params, callback) {
        return this._pool.query(query, params, callback)
    },

    transaction: function (func, callback) {
        var results;

        this.run(function (client, callback) {
            pf.serial(
                function (callback) {
                    client.query('begin', callback);
                },
                function (callback) {
                    func(client, function () {
                        // Capture func results
                        results = arguments;
                        callback.apply(null, arguments);
                    })
                },
                function (callback) {
                    client.query('commit', callback);
                }
            )(function (err) {
                if (err) return client.query('rollback', function () {
                    callback(err);
                });
                // Resend results from func
                callback.apply(null, results);
            })
        }, callback)
    }
}
// Add statement constructors to Conf object
instrument(Conf.prototype);


// Exports
exports.sql = sql;

exports.configure = function (config) {
    return new Conf(config)
}
