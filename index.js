var debug = require('debug')('pg-bricks');
var pf = require('point-free');
var sql = require('sql-bricks-postgres');
var pg = require('pg');


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


function instrument(client) {
    if (client.update) return;

    ['select', 'insert', 'update', 'delete'].forEach(function (statement) {
        client[statement] = function () {
            var query = sql[statement].apply(sql, arguments);

            query.run = function (callback) {
                var config = query.toParams();
                config.callback = callback;
                return this.query(config);
            }.bind(this);

            // Bind accessors
            query.rows = pf.waterfall(query.run, Accessors.rows);
            query.row  = pf.waterfall(query.run, Accessors.row);
            query.col  = pf.waterfall(query.run, Accessors.col);
            query.val  = pf.waterfall(query.run, Accessors.val);

            // Patch insert().select()
            if (statement == 'insert') {
                query.select = function select() {
                    var select = sql.insert.prototype.select.apply(this, arguments);
                    ['run', 'rows', 'row', 'col', 'val'].forEach(function (method) {
                        select[method] = query[method];
                    })
                    return select;
                }
            }

            return query;
        }
    })

    if (client !== Conf.prototype) {
        var oldQuery = client.query;
        client.query = function (query, params, callback) {
            var query = query instanceof pg.Query ? query : new pg.Query(query, params, callback);
            debug('%s %o', query.text, query.values);
            return oldQuery.call(client, query);
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
function Conf(connStr) {
    this._connStr = connStr;
}

Conf.prototype = {
    sql: sql,
    pg: pg,

    run: function (func, callback) {
        pg.connect(this._connStr, function(err, client, done) {
            if (err) return callback(err);

            instrument(client);

            func(client, function () {
                done();
                typeof callback === 'function' && callback.apply(null, arguments);
            })
        });
    },

    query: function (query, params, callback) {
        query = new pg.Query(query, params, callback);
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
                client.query(query);
            }, function () {});
        }

        return instrumentQuery(query);
    },

    // TODO: add .raw(sql, params).<accessor>(...)

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
instrument(Conf.prototype);


// Exports
exports.sql = sql;

exports.configure = function (connStr) {
    return new Conf(connStr)
}
