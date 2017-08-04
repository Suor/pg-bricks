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
db.select().from('user').where({name: userName}).rows(callback);

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

## Promises

...


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

To get a stream just call `.stream()` method on a brick:

```js
var stream = db.select('id, name').from('user').stream();
stream.on('data', ...)
stream.on('end', ...)
stream.on('error', ...)
```

Piping also works, e.g. this way you can export to CSV:

```js
function (req, res) {
    var stream = db.raw('select id, name from user').stream();
    stream.pipe(csv.stringify()).pipe(res);
}
```


## Debugging

`pg-bricks` uses [debug][] package, so you can use:

```bash
DEBUG=pg-bricks node your-app.js
```

to see all the queries on your screen.


## Native bindings

You can use native bindings similar to the way you use it with `pg`:

```js
var db = require('pg-bricks').configure(process.env.DATABASE_URL);
db = db.native;

// ... use db as usual
```

`NODE_PG_FORCE_NATIVE` environment variable will also work as expected:

```bash
NODE_PG_FORCE_NATIVE=1 node your_code.js
```

Note that streaming won't work with native bindings.


## TODO:

- make queries with accessors capable of streaming?


[sql-bricks-postgres]: https://www.npmjs.org/package/sql-bricks-postgres
[sql-bricks]: https://www.npmjs.org/package/sql-bricks
[pg]: https://www.npmjs.org/package/pg
[debug]: https://www.npmjs.org/package/debug
