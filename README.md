# PostgreSQL bricks

This is a PostgreSQL client, which uses [sql-bricks][] as an interface to construct queries
and handles connections and transactions for you.


## Installation

```
npm install pg-bricks
```


## Usage

You can use `select`, `insert`, `update` and `delete` constructors of [sql-bricks][] and
construct your query by chaining their methods. You'll only need to finally call `.run()`
to execute it:

```js
var db = require('pg-bricks').configure(process.env.DATABASE_URL);

db.select().from('user').where('id', id).run(callback);

db.update('user', {last_login: db.sql('now()')}).where('id', id).run(callback);

db.delete('event').where(db.sql.lt('added', new Date('2005-01-01'))).run(callback);
```

As you can see, `db.sql` is a `sql-bricks` object, which you can use to escape raw sql
and construct where conditions.

Connections are handled automatically: a connection is withheld from a pool or created
for you when you need it and returned to the pool once you are done.
You can also manually get connection:

```js
db.run(function (client, callback) {
    // client is a node-postgres client object
    client.query("select * from user where id = $1", [id], callback);

    // it is however extended with sql-bricks query constructors
    client.select().from('user').where('id', id).run(callback);
});
```

You can also wrap your connection in a transaction:

```js
db.transaction(function (client, callback) {
    async.waterfall([
        // .run is a closure, so you can pass it to other function like this:
        client.insert('user', {name: 'Mike'}).returning('id').run,
        // res here is normal node-postgres result
        function (res, callback) {
            var id = res.rows[0].id;
            client.insert('profile', {user_id: id, ...}).run(callback);
        },
    ], callback)
})
```

## Debugging

`pg-bricks` uses [debug][] package, so you can use:

```bash
DEBUG=pg-bricks node your-app.js
```

to see all the queries on your screen.


[sql-bricks]: https://www.npmjs.org/package/sql-bricks
[debug]: https://www.npmjs.org/package/debug
