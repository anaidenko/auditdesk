# API design

When the repository serves an HTTP API (route handlers, an Express or similar server, tRPC or
GraphQL). How the API behaves for the clients that call it: methods, status codes and errors,
lists, shapes, retries, versions and the published contract. Judge each endpoint by what its
clients see, and cite the handler. Security consequences stay with Security (validation at a
trust boundary is SEC-09, error details exposed to clients are SEC-13), and types shared between
this repository's own front end and back end are ARC-07.

Severity: high when ordinary use of the API does harm (a GET that changes or deletes data, which
link prefetchers, crawlers and retries all trigger; a retried payment request that charges
twice). Medium when clients cannot rely on the contract (failures answered with 200, an error
shape per route, lists returned whole, a breaking change with no version). Low for
documentation gaps.

## API-01 Methods and resources

GET, HEAD and OPTIONS handlers that change state; a method that misleads its client (a POST that
only reads, a DELETE that archives, PUT used for a partial update); handlers that accept any
method. How paths are named is style, and not a finding.

## API-02 Status codes and errors

Failures answered with 200 and an error in the body; an error shape per route rather than one for
the API; 500 for the client's mistakes (a missing field, an unknown ID); 401, 403 and 404 used
inconsistently; validation errors that do not name the field they concern.

## API-03 Lists

Collections returned whole, with no limit or pagination; pagination without a stable order;
offset pagination over tables that grow, where a cursor would hold; filter and sort parameters
that differ per route; totals counted on every page. While this aspect runs, the list contract is
filed here and DAT-03 keeps the query behind it.

## API-04 Request and response shapes

Fields named or cased differently across routes; dates and money in mixed formats (ISO 8601
strings, integer cents); `null`, a missing field and an empty value used interchangeably; whole
ORM rows returned, internal fields included (a password hash or a secret in a response is
Security's).

## API-05 Idempotency and retries

Requests that create or charge without an idempotency key or a natural one, so a retry
duplicates them; webhooks processed twice when the sender retries; DELETE and PATCH that fail on
a second identical call where they could succeed.

## API-06 Versioning and compatibility

How a breaking change reaches clients: a version in the path or a header, or none; mobile or
third-party clients that cannot all update at once; fields removed or renamed without a
deprecation period. Often a question.

## API-07 The published contract

An OpenAPI, GraphQL or tRPC schema, and whether it matches the handlers (routes, fields, status
codes); whether it is generated or written by hand; for an API others call, documentation of its
authentication, limits and errors.
