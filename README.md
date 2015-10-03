# PostgreSQL bricks

This is a PostgreSQL client, which uses [PostreSQL extension][sql-bricks-postgres]
of [sql-bricks][] as an interface to construct queries
and handles connections and transactions for you.


## Installation

```
npm install pg-bricks
```


## Usage

You can use `select`, `insert`, `update` and `delete` constructors of [sql-bricks][] and
construct your query by chaining their methods. You'll only need to finally call `.run()` or any data accessor to execute it:

```js
var db = require('pg-bricks').configure(process.env.DATABASE_URL);

// mind using db.sql to wrap now() function
db.update('user', {last_login: db.sql('now()')}).where('id', id).run(callback);

// db.sql contains various utilities to construct where conditions
db.delete('event').where(db.sql.lt('added', new Date('2005-01-01'))).run(...);

// .rows() access selected rows directly, not wrapped into result object
db.select().from('user').where('id', id).rows(callback);

// .row() will pass newly created user to a callback
db.insert('user', data).returning('*').row(callback);
```

As you can see, `db.sql` is a `sql-bricks` object, which you can use to escape raw sql
fragments. You can read about sql-bricks way of constructing
requests in [its documentation](http://csnw.github.io/sql-bricks) and
about PostgreSQL specific parts on [sql-bricks-postgres page][sql-bricks-postgres].

pg-bricks also exposes a reference to used [pg][] library via `db.pg`
in case you want to go low level.

When you need to perform something custom you can resolve to raw sql queries:

```js
// use .raw() for raw sql and .val() to get single value
db.raw('select pg_datatable_size($1)', [tableName]).val(callback);
```


## Connections and transactions

Connections are handled automatically: a connection is withheld from a pool or created
for you when you need it and returned to the pool once you are done.
You can also manually get connection:

```js
db.run(function (client, callback) {
    // client is a node-postgres client object
    // it is however extended with sql-bricks query constructors
    client.select().from('user').where('id', id).run(callback);

    // you also get .raw()
    client.raw("select * from user where id = $1", [id]).run(callback);
}, callback);
```

You can easily wrap your connection in a transaction:

```js
db.transaction(function (client, callback) {
    async.waterfall([
        // .run is a closure, so you can pass it to other function like this:
        client.insert('user', {name: 'Mike'}).returning('id').run,
        // res here is normal node-postgres result,
        // use .val accessor to get id directly
        function (res, callback) {
            var id = res.rows[0].id;
            client.insert('profile', {user_id: id, ...}).run(callback);
        },
    ], callback)
}, callback)
```


## Accessors

There are `.rows()`, `.row()`, `.col()` and `.val()` accessors on pg-bricks queries.
You can use them to extract corresponding part of result conveniently.
Also, `.row()` checks that result contains exactly one row and `.col()` checks that result
contains exactly one column. `.val()` does both:

```js
db.select('id, name').from('user').val(function (err) {
    // err is Error('Expected a single column, multiple found')
})
```


## Streaming

Query objects returned from `.run()` call emit `row`, `end` and `error` events.
This way you can process results without loading all of them into memory at once:

```js
var query = db.select('id, name').from('user').run();
query.on('row', ...)
query.on('end', ...)
query.on('error', ...)
```

It also provides stream-like piping. This way you can export to CSV:

```js
function (req, res) {
    var query = db.raw('select id, name from user').run();
    query.pipe(csv.stringify()).pipe(res);
}
```


## Debugging

`pg-bricks` uses [debug][] package, so you can use:

```bash
DEBUG=pg-bricks node your-app.js
```

to see all the queries on your screen.


## TODO:

- make queries with accessors capable of streaming?


[sql-bricks-postgres]: https://www.npmjs.org/package/sql-bricks-postgres
[sql-bricks]: https://www.npmjs.org/package/sql-bricks
[pg]: https://www.npmjs.org/package/pg
[debug]: https://www.npmjs.org/package/debug
