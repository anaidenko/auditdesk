# Data model and database

From the code alone: schema files, migrations, ORM models and the queries. No database is
connected, so what depends on production data (row counts, real query plans, the size of a
table) becomes a question. SQL injection belongs to Security (SEC-04).

Severity: critical when ordinary use loses or corrupts data now (a destructive migration with no
way back, a race on balances or stock that everyday traffic hits). High when it takes a failure
partway or modest concurrency (money or stock written in several steps outside a transaction,
no unique constraint where duplicates break the product). Medium for performance traps that grow
with the data (no index on a foreign key or a frequent filter, an N+1 in a list endpoint). Low
for hygiene.

## DAT-01 Schema and constraints

Primary and foreign keys declared, not only implied by names; NOT NULL where the code assumes a
value; unique constraints for natural keys (email, slug, external IDs); check constraints and
enums; money as integer cents or a decimal type, never a float; timestamps with a time zone.

## DAT-02 Indexes

Foreign keys and frequent filters or sort keys without an index; composite indexes in an order
no query uses; searches with a leading wildcard or a function on the column (`lower(email)`)
without an index that matches.

## DAT-03 Queries and N+1

Queries inside loops; lazy-loaded relations read while rendering a list; list endpoints without
pagination or a limit; fetching whole rows or all columns where a few are used; counts and
aggregates computed on every request.

## DAT-04 Transactions and concurrency

Writes that must succeed together (an order, its payment, the stock) outside one transaction;
read-modify-write races on balances, counters and inventory; no optimistic locking where two
editors can collide; no idempotency key on writes a client or a queue retries.

## DAT-05 Migrations

Migrations committed and applied in order; destructive changes (dropping or retyping a column)
in one step rather than expand and contract; migrations that lock a large table; data changes
mixed into schema migrations; the ORM schema and the migrations out of step (`prisma db push` or
`synchronize: true` used against production).

## DAT-06 Connections

A new client per request, pool sizes that ignore serverless concurrency, connections that are
never released, no statement or query timeout, an ORM in serverless functions without a pooler.

## DAT-07 Data lifecycle

Soft deletes that some queries ignore, cascades that delete more than intended, personal data
kept with no retention rule, seed or test data in production migrations. Backups and restores
are a question unless the repository shows them (Production readiness covers the rest).

## DAT-08 The data access layer

Raw SQL scattered through handlers instead of one layer; the ORM bypassed where it would be
safer, or forced where SQL is needed; JSON columns holding data the code queries relationally.
