# PostgreSQL bricks

This is a PostgreSQL client, which uses [PostreSQL extension][sql-bricks-postgres]
of [sql-bricks][] as an interface to construct queries
and handles connections and transactions for you.


## Usage

You can use `select`, `insert`, `update` and `delete` constructors of [sql-bricks][] and
construct your query by chaining their methods. You'll only need to finally call `.run()` or any data accessor to execute it:

```js
const db = require('pg-bricks').configure(process.env.DATABASE_URL);

// mind using db.sql to wrap now() function
await db.update('user', {ll: db.sql('now()')}).where('id', id).run();

// db.sql contains various utilities to construct where conditions
db.delete('event').where(db.sql.lt('added', new Date('2005-01-01')))
    .run().then(...);

// access selected rows directly, not wrapped into result object
let users = await db.select().from('user').where({name: name}).rows()

// all functions switch to callback style when one is passed
db.insert('user', data).returning('*').row(function (err, user) {});
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
let size = await db.raw('select pg_datatable_size($1)',
                        [tableName]).val();
```

## Configuration

You can supply either connection string or connection config to `.configure()`:

```js
const bricks = require('pg-bricks');
const db1 = bricks.configure('postgresql://dbuser:pass@dbhost/mydb');
const db2 = bricks.configure({
    host: 'dbhost',
    database: 'mydb2',
    user: 'dbuser',
    password: 'pass',
});
```

Or you can use [environment variables](https://www.postgresql.org/docs/9.6/static/libpq-envars.html) same as libpq uses to connect to a PostgreSQL server:

```bash
$ PGHOST=dbhost PGPORT=5433 \
  PGDATABASE=mydb PGUSER=dbuser PGPASSWORD=pass \
  node script.js
```

If you are using connection config it is passed directly to `node-postgres`,
so you may take a look at its [Connecting](https://node-postgres.com/features/connecting)
and [SSL/TLS](https://node-postgres.com/features/ssl) documentation pages.


## Connections and transactions

Connections are handled automatically: a connection is withheld from a pool or created
for you when you need it and returned to the pool once you are done.
You can also manually get connection:

```js
await db.run(async (client) => {
    // client is a node-postgres client object
    // it is however extended with sql-bricks query constructors
    await client.select().from('user').where('id', id).run();

    // you also get .raw()
    await client.raw("select * from user where id = $1", [id]).row()
})
```

You can easily wrap your connection in a transaction:

```js
await db.transaction(async (client) => {
    let id = await client.insert('user', ...).returning('id').val()
    await client.insert('profile', {user_id: id, ...}).run()
})
```


## Accessors

There are `.rows()`, `.row()`, `.col()` and `.val()` accessors on pg-bricks queries.
You can use them to extract corresponding part of result conveniently.
Also, `.row()` checks that result contains exactly one row and `.col()` checks that result
contains exactly one column. `.val()` does both:

```js
await db.select('id', 'name').from('user').val()
// throws Error('Expected a single column, multiple found')
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


## Callbacks

All execute methods such as `query.run()` and all the accessors automatically switch between promise and callback modes as on the examples above. `db.run()` and `db.transaction()` additionally switch their expectation of body function:

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
}, done)
```

[sql-bricks-postgres]: https://www.npmjs.org/package/sql-bricks-postgres
[sql-bricks]: https://www.npmjs.org/package/sql-bricks
[pg]: https://www.npmjs.org/package/pg
[debug]: https://www.npmjs.org/package/debug
