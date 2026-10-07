# Seams between repositories

On when the project has more than one repository, such as a front end and the API it calls. This
agent reads every repository at once: each path starts with the repository's name (`web/src/api.ts`,
`api/src/routes.ts`), and list_files at the root names them. The other aspects examined each
repository on its own, and their findings are listed below; report here only what shows where the
repositories meet, with evidence on both sides when there are two. A finding with no counterpart in
the other repository belongs to that repository's aspects, not here.

Severity: critical when the seam exposes users' data or a live credential to anyone now (a route
the front end calls with no check on the server, a server secret in the browser bundle). High when
it needs modest preconditions or breaks a core flow for some users. Medium is a contract that fails
under unusual input or misleads the next change. Low is drift that will break later.

## SEA-01 The API contract

Every call the front end makes (fetch, axios, a generated client, Server Actions calling another
service) against a route the back end really exposes: method, path, parameters and body shape,
the response fields the front end reads. Calls to routes that do not exist, routes the front end
relies on that the back end changed, and types copied by hand that have drifted.

## SEA-02 Authentication across the boundary

How the token or session travels (cookie, header, query string) and where the browser keeps it;
whether every back-end route the front end calls checks it, routes the front end hides behind a
login screen but the server serves to anyone, and how the front end handles an expired session.

## SEA-03 Authorization the front end assumes

Rules only the front end enforces: buttons hidden by role, IDs the user cannot change in the UI but
can in the request, admin pages whose API is not checked on the server. Cite the front end's check
and the server route that lacks it.

## SEA-04 CORS, origins and cookies

The back end's allowed origins against the front end's real origin; a wildcard with credentials;
an origin reflected from the request; SameSite and Secure flags that fit how the two are deployed;
CSRF protection where cookies carry the session across origins.

## SEA-05 Validation only on the client

Rules the front end enforces that the back end does not: lengths, formats, ranges, required fields,
allowed values, file types and sizes. A request sent past the form must meet the same rules.

## SEA-06 Secrets and internal details in the browser bundle

Environment variables exposed to the browser (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `PUBLIC_`)
that hold a server's secret or an internal URL; keys the back end treats as secret but the front end
ships; source maps or debug endpoints the front end points at in production.

## SEA-07 Errors and data across the boundary

Errors the back end returns that the front end does not handle (a blank screen, a stuck spinner, a
silent retry that doubles a payment); fields the back end sends that the front end never needs and
should not see (password hashes, other users' data, internal IDs); pagination and limits the two
sides disagree on.
