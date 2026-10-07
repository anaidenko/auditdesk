# Multi-tenancy

When records belong to tenants (organisation, account, workspace or team IDs on rows, a schema
or a database per customer). This aspect owns tenant isolation; Security's SEC-03 covers
authorization within one tenant.

Severity: critical when anyone who can sign up, or any user of another tenant, can read or
change a tenant's data now. High when it needs modest preconditions (a staff role, an ID that
has to be learnt first), or when isolation depends on something that will fail (a filter each
query must remember, a cache key without the tenant). Medium for gaps that need an insider or
unusual state. Low for defence in depth (no second layer such as row-level security).

## TEN-01 The tenant model

How tenancy is represented (a column per row, a schema or a database per tenant); every
tenant-owned table carries the tenant key, NOT NULL and indexed; unique constraints include it
where they should (an email unique per tenant, not globally, or the reverse).

## TEN-02 Resolving the tenant

Where the current tenant comes from (the session, a subdomain, a header, the path) and whether
the client can choose it (a `tenantId` in the body or the query that the server trusts);
membership checked whenever a user switches tenants.

## TEN-03 Scoping every query

Every read of tenant-owned data filtered by the tenant: by ORM middleware, extensions or scoped
repositories, or by hand in each query. Raw SQL, aggregates, exports, search, reports and admin
tools included; lookups by ID that skip the tenant filter.

## TEN-04 Writes and relations

Records created or linked across tenants (a foreign key to another tenant's row), bulk updates
and deletes scoped to the tenant, cascades that cross tenants.

## TEN-05 Caches, files and search

Cache keys, object-storage paths, CDN URLs, search indexes and signed URLs that include the
tenant, or can be guessed across tenants.

## TEN-06 Jobs and events

Background jobs, queues, webhooks and emails carry the tenant and check it again when they run;
jobs that loop over every tenant isolate one tenant's failure from the rest.

## TEN-07 Defence in depth

PostgreSQL row-level security or a second check behind the application's filter, tests that try
cross-tenant access, audit logs per tenant, rate limits per tenant.
