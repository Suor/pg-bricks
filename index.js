var debug = require('debug')('pg-bricks');
var sql = require('sql-bricks');
var pg = require('pg');


var pf = {
    series: function () {
        var tasks = [].slice.call(arguments);
        var results = [];
        var index = -1;
        var args, callback;

        function handler(err) {
            if (err) return callback(err);
            index++;
            // TODO: handle no results / more than 1 result
            if (index) results.push(arguments[1]);
            if (index >= tasks.length) return callback(null, results);

            tasks[index].apply(null, args.concat([handler]))
        }

        return function () {
            args = [].slice.call(arguments);
            callback = args.pop();

            handler.apply(null, [null].concat(args));
        };

    }
}


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
        // TODO: deal with absense of params or even callback
        this.run(function (client, callback) {
            client.query(query, params, callback); // Don't need to instrument this
        }, callback);
    },

    transaction: function (func, callback) {
        this.run(function (client, callback) {
            pf.series(
                function (callback) {
                    client.query('begin', callback);
                },
                func.bind(null, client),
                function (callback) {
                    client.query('commit', callback);
                }
            )(function (err, results) {
                if (err) return client.query('rollback', function () {
                    callback(err);
                });
                callback(null, results[1]);
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
