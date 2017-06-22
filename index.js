var debug = require('debug')('pg-bricks');
var pf = require('point-free');
var sql = require('sql-bricks-postgres');
var url = require('url');
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


function instrument(client) {
    if (client.update) return;

    // Monkey patch statement constructors to pg client and make them runnable
    ['select', 'insert', 'update', 'delete', 'raw'].forEach(function (statement) {
        client[statement] = function () {
            var brick = statement == 'raw' ? RawSQL.apply(this, arguments)
                                           : sql[statement].apply(sql, arguments);

            brick.run = function (callback) {
                var config = brick.toParams();
                config.callback = callback;
                return this.query(config);
            }.bind(this);

            // Bind accessors
            brick.rows = pf.waterfall(brick.run, Accessors.rows);
            brick.row  = pf.waterfall(brick.run, Accessors.row);
            brick.col  = pf.waterfall(brick.run, Accessors.col);
            brick.val  = pf.waterfall(brick.run, Accessors.val);

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

    if (client !== Conf.prototype) {
        var oldQuery = client.query;
        client.query = function (query, params, callback) {
            var query = query instanceof Query ? query : new Query(query, params, callback);
            debug('%s %o', query.text, query.values);
            return instrumentQuery(oldQuery.call(client, query));
        }
    }
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
function Conf(connStr, _pg) {
    this._connStr = connStr;
    this._pg = _pg || pg;

    var params = url.parse(connStr);
    var auth = params.auth.split(':');

    this._config = {
        user: auth[0],
        password: auth[1],
        host: params.hostname,
        port: params.port,
        database: params.pathname.split('/')[1],
        ssl: true
    };

    this._pool = new this._pg.Pool(this._config);
}

Conf.prototype = {
    sql: sql,
    pg: pg,

    get native () {
        return new Conf(this._connStr, pg.native);
    },

    run: function (func, callback) {
        this._pool.connect(function(err, client, done) {
            if (err) return callback(err);

            instrument(client);

            func(client, function () {
                done();
                callback.apply(null, arguments);
            })
        });
    },

    query: function (query, params, callback) {
        query = new Query(query, params, callback);
        callback = query.callback;

        if (callback) {
            // Callback style
            this.run(function (client, done) {
                query.callback = done;
                client.query(query);
            }, callback);
        } else {
            // Streaming style
            this.run(function (client, done) {
                query.on('end', done);
                query.on('error', done);
                var q = client.query(query);
                // HACK: when using pg-native, q will be NativeQuery,
                //       so we need to route all events.
                if (q !== query) {
                    q.on('row', query.emit.bind(query, 'row'));
                    q.on('end', query.emit.bind(query, 'end'));
                    q.on('error', query.emit.bind(query, 'error'));
                }
            }, function () {});
        }

        return instrumentQuery(query);
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

exports.configure = function (connStr) {
    return new Conf(connStr)
}
