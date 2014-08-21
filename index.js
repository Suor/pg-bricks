var async = require('async');
var debug = require('debug')('pg-bricks');
var sql = require('sql-bricks');
var pg = require('pg');


function instrument(client) {
    if (client.update) return;

    ['select', 'insert', 'update', 'delete'].forEach(function (statement) {
        client[statement] = function () {
            var query = sql[statement].apply(sql, arguments);
            query.run = function (callback) {
                var compiled = query.toParams();
                return this.query(compiled.text, compiled.values, callback);
            }.bind(this);
            return query;
        }
    })

    if (client !== Conf.prototype && debug.enabled) {
        var oldQuery = client.query;
        client.query = function (query, params) {
            var message = query;
            if (typeof params != 'function') {
                message += '; [' + params.join(', ') + ']'
            }
            debug(message);
            oldQuery.apply(client, arguments);
        }
    }
}


// A Conf object
function Conf(connStr) {
    this._connStr = connStr;
}

Conf.prototype = {
    sql: sql,

    run: function (func, callback) {
        pg.connect(this._connStr, function(err, client, done) {
            if (err) return callback(err);

            instrument(client);

            func(client, function () {
                done();
                callback.apply(null, arguments);
            })
        });
    },

    query: function (query, params, callback) {
        this.run(function (client, callback) {
            client.query(query, params, callback);
        }, callback);
    },

    transaction: function (func, callback) {
        var results;

        this.run(function (client, callback) {
            async.series([
                function (callback) {
                    client.query('begin', callback);
                },
                function (callback) {
                    func(client, function () {
                        results = arguments; // pass these out
                        callback.apply(null, arguments)
                    });
                },
                function (callback) {
                    client.query('commit', callback);
                },
            ], function (err) {
                if (err) return client.query('rollback', function () {
                    callback(err);
                });
                callback.apply(null, results);
            });
        }, callback);
    }
}
instrument(Conf.prototype);


// Exports
exports.sql = sql;

exports.configure = function (connStr) {
    return new Conf(connStr)
}
