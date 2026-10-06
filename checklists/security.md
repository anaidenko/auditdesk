# Security

Always on. Examine each item against the repository's own code. Scanner results are leads,
already filed as findings; report what they missed. When the multi-tenancy aspect is on,
tenant scoping belongs to it, not to SEC-03.

Severity: critical means exploitable now by an unauthenticated attacker with serious impact
(all users' data, remote code execution, a live credential). High means exploitable with modest
preconditions (any signed-in user, a guessable ID), or serious impact for some users. Medium
needs unusual conditions or has limited impact. Low is defence in depth.

## SEC-01 Authentication

Password storage (bcrypt, scrypt or argon2 with a work factor; never a fast hash), login,
registration, password reset and email change flows, account enumeration through messages or
timing, MFA where the product offers it, lockout or throttling on the authentication endpoints.

## SEC-02 Sessions and tokens

JWT verification (signature checked, `alg` pinned, `none` refused, expiry enforced, secret
strength), token storage in the browser, cookie flags (HttpOnly, Secure, SameSite), session
fixation, logout and revocation, refresh-token rotation.

## SEC-03 Authorization on every route

Every handler, Server Action, resolver and socket event checks who the caller is and what they
may do. Object-level checks: an ID from the request is checked against the caller's rights
(IDOR). Admin routes are guarded on the server, not only hidden in the UI. Angular and React
route guards are UX, not authorization.

## SEC-04 Injection

SQL and NoSQL built from strings (raw ORM queries, `$queryRawUnsafe`, string-built Mongo
filters), command execution with request data, `eval`, `new Function`, template injection,
regular expressions built from input.

## SEC-05 Cross-site scripting

`dangerouslySetInnerHTML`, `innerHTML`, `v-html`, Angular's `bypassSecurityTrust*`, unescaped
server templates, user-controlled URLs in `href` or `src` (`javascript:`), Markdown rendered
without sanitising.

## SEC-06 Cross-site request forgery and CORS

State changes on GET, cookie-authenticated mutations without a CSRF defence, CORS that
reflects any origin with credentials, wildcard origins on authenticated APIs.

## SEC-07 Server-side request forgery

Server-side fetches of URLs the user controls (webhooks, image proxies, URL previews, PDF
renderers), without an allowlist or with redirects followed to internal addresses.

## SEC-08 File uploads and paths

Type and size checks on uploads, storage outside the web root, generated file names, path
traversal in downloads and archive extraction.

## SEC-09 Input validation and mass assignment

Schema validation at every trust boundary (request bodies, query strings, webhooks, queue
messages), validation done only on the client, request bodies spread into ORM updates.

## SEC-10 Secrets

Credentials in the code or the history (gitleaks), secrets shipped to the browser bundle
(`NEXT_PUBLIC_`, `VITE_`, Angular `environment.ts`), committed `.env` files, secrets in
Dockerfiles or CI files, default or shared credentials.

## SEC-11 Security headers and transport

Content-Security-Policy, HSTS, frame protection, `X-Content-Type-Options`, cookies without
Secure, HTTP URLs to the app's own APIs, TLS verification turned off.

## SEC-12 Rate limiting and abuse

Expensive or enumerable endpoints without limits (login, reset, search, export, AI calls),
unbounded pagination, uploads without size caps.

## SEC-13 Logging and error exposure

Passwords, tokens, keys or personal data written to logs or analytics; stack traces or SQL
errors returned to clients; verbose error pages in production.

## SEC-14 Cryptography

Weak algorithms (MD5, SHA-1 for passwords, ECB), `Math.random` for tokens or IDs that must be
unguessable, home-grown crypto, hard-coded IVs or salts.

## SEC-15 Other dangerous patterns

What Semgrep flags outside the items above, and anything exploitable that fits no other item.
