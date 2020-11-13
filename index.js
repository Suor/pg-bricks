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


function RawSQL(text, values) {
    return {
        toParams: function () {
            return {text: text, values: values || []}
        }
    }
}


function optionalPromisify(func) {
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

function promisify(callback) {
    if (callback) return {callback: callback, result: undefined}

    var rej, res;
    var cb = function (err, client) {
        err ? rej(err) : res(client)
    }
    var result = new Promise(function (resolve, reject) {
        res = resolve
        rej = reject
    })
    return {callback: cb, result: result}
}

function callbackify(func) {
    return function (client, callback) {
        func(client).then(function (data) {callback(null, data)}).catch(callback);
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
                debug('%s %o', config.text, config.values);
                return this.query(config, callback)
            }.bind(this);

            // Bind accessors
            brick.rows = optionalPromisify(pf.waterfall(brick.run, Accessors.rows));
            brick.row  = optionalPromisify(pf.waterfall(brick.run, Accessors.row));
            brick.col  = optionalPromisify(pf.waterfall(brick.run, Accessors.col));
            brick.val  = optionalPromisify(pf.waterfall(brick.run, Accessors.val));

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

            brick.stream = function () {
                var QueryStream = require('pg-query-stream');
                var config = brick.toParams();
                debug('%s %o', config.text, config.values);
                if (!this.run) {
                    return this.query(new QueryStream(config.text, config.values))
                }

                // TODO: get rid of PassThrough stream once the issue below is fixed,
                //       see https://github.com/brianc/node-pg-query-stream/issues/28
                var PassThrough = require('stream').PassThrough;
                var fakeStream = new PassThrough({objectMode: true});

                this.run(function (client, callback) {
                    var stream = client.query(new QueryStream(config.text, config.values));
                    stream.pipe(fakeStream);
                    stream.on('error', callback);
                    stream.on('end', function () {callback()});
                }, function (err) {
                    if (err) fakeStream.emit('error', err);
                })

                return fakeStream;
            }.bind(this);

            return brick;
        }
    })
}


// A Conf object
function Conf(config, _pg) {
    if (typeof config === 'string') config = {connectionString: config};
    this._config = config;
    this._pg = _pg || pg;
    this._pool = new this._pg.Pool(config);
}

Conf.prototype = {
    sql: sql,
    pg: pg,

    get native () {
        return new Conf(this._config, pg.native);
    },

    run: function (func, callback) {
        var response = promisify(callback);
        var func = callback ? func : callbackify(func);

        this._pool.connect(function(err, client, done) {
            if (err) return response.callback(err);

            instrument(client);

            func(client, function () {
                done();
                response.callback.apply(null, arguments);
            })
        });

        return response.result;
    },

    query: function (query, params, callback) {
        return this._pool.query(query, params, callback)
    },

    transaction: function (func, callback) {
        var response = promisify(callback);
        var func = callback ? func : callbackify(func);
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
        }, response.callback);

        return response.result;
    },

    end: function (callback) {
        return this._pool.end(callback);
    }
}
// Add statement constructors to Conf object
instrument(Conf.prototype);


// Exports
exports.sql = sql;

exports.configure = function (config) {
    return new Conf(config)
}
