# Security

Always on. Examine each item against the repository's own code. Scanner results are leads,
already filed as findings; report what they missed. When the multi-tenancy aspect is on,
tenant scoping belongs to it, not to SEC-03. When the LLM integrations aspect is off, prompt
injection that reaches tools or data is filed here, under SEC-04.

Severity: critical when anyone who can reach the app, or sign up for it, can exploit it now
with serious impact (all users' data, remote code execution, a live credential). High when it
needs modest preconditions (an account with a particular role, an ID that has to be learnt
first) or harms some users. Medium needs unusual conditions or has limited impact. Low is
defence in depth.

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
route guards are UX, not authorization. Responses that depend on the user are never served
from a shared cache: Next.js `unstable_cache` or `"use cache"` without the user in the key,
`fetch` cached by default in Next.js 13 and 14, `Cache-Control: public` on authenticated
responses, a CDN caching personalised pages.

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

Expensive or enumerable endpoints without limits (login, reset, search, export, AI calls) and
uploads without size caps. Pagination belongs to DAT-03.

## SEC-13 Logging and error exposure

Passwords, tokens, keys or personal data written to logs or analytics; stack traces or SQL
errors returned to clients; verbose error pages in production.

## SEC-14 Cryptography

Weak algorithms (MD5, SHA-1 for passwords, ECB), `Math.random` for tokens or IDs that must be
unguessable, home-grown crypto, hard-coded IVs or salts.

## SEC-15 Other dangerous patterns

What Semgrep flags outside the items above, and anything exploitable that fits no other item.

## SEC-16 Gaps typical of generated code (AI-built)

Authorization present on some routes and missing on their siblings (the list endpoint checks,
the export or delete endpoint does not); validation applied unevenly across handlers that take
the same input; placeholder secrets, demo accounts or `TODO: add auth` left on live paths;
security code copied from an example and never adapted (a JWT secret of `"secret"`, CORS `*`).
