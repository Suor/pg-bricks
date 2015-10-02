var assert = require('assert');
var pf = require('point-free');
var pg = require('./index').configure('postgres://postgres@localhost/pg_bricks');


var INITIAL = [
    {title: 'apple', price: 10},
    {title: 'orange', price: 20},
]


describe('pg-bricks', function () {
    before(function (done) {
        // Create test database and fill a test data
        var pgsu = require('./index').configure('postgres://postgres@localhost/postgres');

        pf.serial(
            pgsu.query.bind(pgsu, 'drop database if exists pg_bricks', []),
            pgsu.query.bind(pgsu, 'create database pg_bricks', []),
            pg.query.bind(pg, 'create table item (id serial, title text, price int)', []),
            pg.insert('item', INITIAL).run
        )(function (err, res) {
            done(err);
        })
    })


    it('should run query', function (done) {
        pg.query('select 42 as x', [], function (err, res) {
            assert.ifError(err);
            assert.equal(res.command, 'SELECT');
            assert.deepEqual(res.rows, [{x: 42}]);
            done();
        })
    })

    it('should support sql-bricks', function (done) {
        pf.waterfall(
            pg.select('title', 'price').from('item').run,
            function (res, callback) {
                assert.deepEqual(res.rows, INITIAL);
                done();
            }
        )(done)
    })

    describe('Accessors', function () {
        it('should provide .rows', function (done) {
            pf.waterfall(
                pg.select('title', 'price').from('item').rows,
                function (rows, callback) {
                    assert.deepEqual(rows, INITIAL);
                    done();
                }
            )(done)
        })

        it('should provide .col', function (done) {
            pf.waterfall(
                pg.select('title').from('item').col,
                function (col, callback) {
                    assert.deepEqual(col, ['apple', 'orange']);
                    done();
                }
            )(done)
        })

        it('should provide .val', function (done) {
            pf.waterfall(
                pg.select('price').from('item').where({title: 'apple'}).val,
                function (price, callback) {
                    assert.equal(price, 10);
                    done();
                }
            )(done)
        })
    })

    it('should return EventEmitter', function (done) {
        var query = pg.select('title', 'price').from('item').where({price: 10}).run();

        query.on('row', function (row) {
            assert.deepEqual(row, {"title": "apple", "price": 10})
        });
        query.on('end', function () {
            done();
        })
    })

    it('should pipe', function (done) {
        var query = pg.query('select title, price from item where price = 10');
        var store = new StoreStream();

        query.pipe(store);
        query.on('end', function () {
            assert.deepEqual(store._store, [{"title": "apple", "price": 10}])
            done();
        })
    })
})


// Helper stream
var stream = require('stream')
var util   = require('util');

util.inherits(StoreStream, stream.Writable);
function StoreStream(options) {
    stream.Writable.call(this, options);
    this._store = [];
}

StoreStream.prototype.write = function (chunk, encoding, callback) {
    this._store.push(chunk);
};
