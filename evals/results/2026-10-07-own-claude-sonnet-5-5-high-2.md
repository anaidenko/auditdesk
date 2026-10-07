# Eval: own, claude-sonnet-5-5 at high

- **Date:** 2026-10-07T16:43:19.783Z
- **Fixture:** own, upstream `32aee95a5bfc9ae48f8d25b2c97da263ff078a45`, prepared `ab9ee39353b5fd7b61caa2f2d09e31d1e6dd2a19`
- **Auditdesk:** `966b7a8949f244c57d972e0fdadd0fe6ad849dd6`, with uncommitted changes; key digest `a71f88ec781b`; prices as of 2026-10-07
- **Aspects:** security, dependencies, architecture, data, quality, production, api, performance, accessibility, llm, tenancy
- **Access:** Claude plan (API-equivalent dollars, not billed)
- **Budget:** $11.00, 550,000 tokens
- **Duration:** 13 min 58 s; **calls:** 85; **cache-read share:** 84%

## Recall

**28 of 38** key entries found (74%); agents alone: 28 of 38.

| Entry | Item | Title | Found by |
| --- | --- | --- | --- |
| OWN-01 | SEC-03 | Any signed-in customer can read another customer's order by its ID | missed |
| OWN-02 | SEC-03 | Any signed-in user, customers included, can delete products: only the page hides the button | F-005 |
| OWN-03 | SEC-05 | Product descriptions are rendered as raw HTML | F-003 |
| OWN-04 | SEC-07 | The avatar endpoint fetches any URL a user gives it, from the server | F-004 |
| OWN-05 | SEC-10 | The shipping API secret is shipped to every browser | F-006 |
| OWN-06 | DEP-04 | The request package is deprecated and unmaintained | F-014 |
| OWN-07 | DEP-06 | npm install downloads and runs a remote script | missed |
| OWN-08 | DEP-02 | The lock file does not match package.json, so npm ci fails | F-013 |
| OWN-09 | ARC-01 | A presentational component queries the database for every card | missed |
| OWN-10 | ARC-03 | Order confirmation emails fail silently | F-015, F-020 |
| OWN-11 | ARC-03 | The payments webhook swallows errors and acknowledges lost refunds | missed |
| OWN-12 | DAT-02 | OrderItem.orderId has no index | F-026 |
| OWN-13 | DAT-03 | The order list queries each order's items separately | F-027 |
| OWN-14 | DAT-04 | Checkout writes the order, the stock and the payment outside one transaction | F-024 |
| OWN-15 | QUA-02 | The payments module, refunds included, has no tests | F-033 |
| OWN-16 | QUA-03 | The sign-up form accepts 8-character passwords the server rejects | F-034 |
| OWN-17 | PRD-04 | No health check for the platform to probe | F-041 |
| OWN-18 | PRD-01 | The payments secret is read when the module loads, so builds and tests need it | missed |
| OWN-19 | PRD-06 | Are the database and uploaded avatars backed up, and has a restore been tested? | F-045 |
| OWN-20 | PRD-03 | Who is alerted when checkout or the payments webhook starts failing? | missed |
| OWN-21 | LLM-01 | Customer reviews reach the description prompt, where they can carry instructions | F-067 |
| OWN-22 | LLM-03 | The model's HTML is saved unvalidated and later rendered raw | F-068 |
| OWN-23 | LLM-04 | The model call sets no output limit | missed |
| OWN-24 | TEN-03 | Staff of any store see the whole platform's revenue | missed |
| OWN-25 | TEN-05 | The top-products cache is shared by every store | missed |
| OWN-26 | API-01 | Opening a link is enough to cancel an order, since the cancel endpoint answers GET | F-008 |
| OWN-27 | API-02 | A refused cancellation is answered with status 200 | F-046 |
| OWN-28 | API-03 | The product list endpoint returns a store's whole catalogue in one response | F-049 |
| OWN-29 | API-05 | A retried checkout request creates a second order and charges the card again | F-015, F-048 |
| OWN-30 | PRF-02 | The shipping page waits for nine carrier rates one after another | missed |
| OWN-31 | PRF-01 | Standard carrier rates are fetched again for every view of the shipping page | F-052 |
| OWN-32 | PRF-04 | Product search requests the catalogue after every render, which re-renders it, without end | F-054 |
| OWN-33 | PRF-05 | Store banners load at full size with no dimensions or responsive sizes | F-053 |
| OWN-34 | ACC-01 | Search result thumbnails have no alt text, so screen readers read out file names | F-066 |
| OWN-35 | ACC-02 | Sign-up, shipping and search fields are labelled only by their placeholders | F-061 |
| OWN-36 | ACC-03 | The sort switch in search is a span that only a mouse can use | F-062 |
| OWN-37 | ACC-03 | Keyboard focus is invisible on every link, button and field | F-060 |
| OWN-38 | ACC-06 | Store names are grey on white at about 2.8:1, under the 4.5:1 minimum | F-064 |

Located under another item (not counted as found):

- F-007 on OWN-06 (DEP-04), filed under SEC-15
- F-007 on OWN-07 (DEP-06), filed under SEC-15
- F-012 on OWN-11 (ARC-03), filed under SEC-09
- F-016 on OWN-32 (PRF-04), filed under ARC-05
- F-017 on OWN-25 (TEN-05), filed under ARC-02
- F-018 on OWN-02 (SEC-03), filed under ARC-01
- F-018 on OWN-15 (QUA-02), filed under ARC-01
- F-019 on OWN-14 (DAT-04), filed under ARC-02
- F-019 on OWN-27 (API-02), filed under ARC-02
- F-021 on OWN-05 (SEC-10), filed under ARC-04
- F-021 on OWN-10 (ARC-03), filed under ARC-04
- F-021 on OWN-15 (QUA-02), filed under ARC-04
- F-021 on OWN-18 (PRD-01), filed under ARC-04
- F-023 on OWN-22 (LLM-03), filed under ARC-06
- F-023 on OWN-23 (LLM-04), filed under ARC-06
- F-023 on OWN-30 (PRF-02), filed under ARC-06
- F-023 on OWN-31 (PRF-01), filed under ARC-06
- F-025 on OWN-24 (TEN-03), filed under DAT-02
- F-028 on OWN-15 (QUA-02), filed under DAT-04
- F-029 on OWN-02 (SEC-03), filed under DAT-07
- F-029 on OWN-27 (API-02), filed under DAT-07
- F-035 on OWN-15 (QUA-02), filed under QUA-07
- F-035 on OWN-24 (TEN-03), filed under QUA-07
- F-036 on OWN-15 (QUA-02), filed under QUA-07
- F-037 on OWN-15 (QUA-02), filed under QUA-01
- F-042 on OWN-05 (SEC-10), filed under PRD-01
- F-042 on OWN-10 (ARC-03), filed under PRD-01
- F-050 on OWN-01 (SEC-03), filed under API-04
- F-050 on OWN-13 (DAT-03), filed under API-04
- F-050 on OWN-24 (TEN-03), filed under API-04
- F-055 on OWN-14 (DAT-04), filed under PRF-02
- F-055 on OWN-29 (API-05), filed under PRF-02
- F-057 on OWN-04 (SEC-07), filed under PRF-06
- F-069 on OWN-21 (LLM-01), filed under LLM-07
- F-069 on OWN-22 (LLM-03), filed under LLM-07
- F-069 on OWN-23 (LLM-04), filed under LLM-07
- F-071 on OWN-01 (SEC-03), filed under TEN-03
- F-073 on OWN-14 (DAT-04), filed under TEN-07
- F-073 on OWN-15 (QUA-02), filed under TEN-07
- F-073 on OWN-22 (LLM-03), filed under TEN-07
- F-073 on OWN-29 (API-05), filed under TEN-07
- F-074 on OWN-12 (DAT-02), filed under TEN-04

## Findings outside the key

**False findings: 4**, and 22 filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.

- F-031 (DAT-01, prisma/migrations/20250301120000_init/migration.sql:31-45): No CHECK constraints on money, stock or rating; seed has no natural key
- F-056 (PRF-02, src/app/api/signup/route.ts:7-23): Unauthenticated signup runs costly scrypt with no limit on concurrency
- F-058 (PRF-06, src/lib/cache.ts:1-9): In-memory cache never evicts and lets concurrent misses all hit the database
- F-072 (TEN-02, src/app/products/[id]/page.tsx:7-10): Public product page looks up products by ID with no store context

On known issues (neither found nor false): F-001, F-002, F-009, F-010, F-011, F-022, F-030, F-038, F-039, F-040, F-043, F-044, F-047, F-063, F-065.
Questions outside the key: 4.

## Cost

| Model | Calls | Cost |
| --- | --- | --- |
| claude-sonnet-5-5 | 85 | $2.31 |

Agents: $2.31.

## Agents

| Aspect | Status | Coverage | Summary or note |
| --- | --- | --- | --- |
| security | done | 14 examined, 1 partly, 0 not examined, 0 not reported | Reviewed all route handlers, the admin server actions, session handling, payments/webhook, upload, LLM description flow, config and Dockerfile. Filed 9 findings (F-003 to F-011 range): stored XSS via LLM HTML, SSRF in avatar fetch, missing role check on deleteProduct, NEXT_PUBLIC shipping secret, curl\|sh postinstall, destructive GET cancel, no rate limiting, missing security headers, session revocation, webhook robustness. Passwords use scrypt with a sane work factor; JWT alg is pinned; raw SQL is parameterised. Observed but left to other aspects: sales report and the 'top-products' cache are not scoped by storeId (multi-tenancy); useEffect without deps in ProductSearch (performance). No login/reset/email-change flow exists in the repo, so those parts of SEC-01 could not be assessed; logging was not found to be an issue (no console calls). |
| dependencies | done | 8 examined, 0 partly, 0 not examined, 0 not reported | Reviewed package.json, package-lock.json, Dockerfile, .nvmrc and import sites. Filed two findings: the lock file is stale and would break `npm ci` (F-013), and the deprecated `request` package is used in src/lib/shipping.ts (F-014). F-014 notes that the F-002 advisory is probably not reachable, because the URL comes from the environment. F-001 (Next) is real because Next ships, but it was scored against the stale 15.1.0 pin. The manifest asks for 15.3.2, which is also old. The postinstall curl\|sh is already filed as F-007. No .npmrc or .yarnrc is present. Versions are pinned exactly. Node is declared as >=22 in engines, 22 in .nvmrc and node:22 in the Dockerfile, so they agree. No CI config exists to check. No duplicated libraries were found. |
| architecture | done | 6 examined, 2 partly, 0 not examined, 0 not reported | Examined all routes, lib modules and key components. Filed 8 findings: non-transactional checkout, endless refetch loop in ProductSearch, tenant-unsafe shared cache, missing central authorization layer, cancel not restoring stock, swallowed errors/no error boundaries, scattered config, duplicated shipping integration, and serial shipping calls. Did not re-report scanner/other findings (F-003..F-014). ARC-07 and ARC-08 examined lightly: API types are hand-written on both sides (ProductSearch Product type, ShippingEstimate) but no confirmed drift beyond the issues above; client-side fetching in ProductSearch is noted within the ARC-05 finding. |
| data | done | 6 examined, 2 partly, 0 not examined, 0 not reported | Reviewed the Prisma schema, the single init migration, the seed script and every handler, page and component that queries the database. The schema basics are sound: integer-cents money, timestamptz, declared foreign keys, a (storeId, email) unique constraint, and a PrismaClient singleton. Filed 9 items. F-024: checkout never checks stock. F-025: the sales report is not scoped by store. F-026: OrderItem.orderId has no index. F-027: N+1 queries in the order list and ProductCard. F-028: refund race with no idempotency key. F-029: hard deletes and the RESTRICT FKs. F-030: avatar bytea. F-031: no CHECK constraints, and a non-idempotent seed. F-032 is a question about how migrations are applied, pooling and backups. I did not re-report the checkout transaction (F-015) or the missing stock return on cancel (F-019). Nothing was examined against real data, so table sizes and query plans are unknown. |
| quality | done | 6 examined, 1 partly, 0 not examined, 0 not reported | I filed six findings (F-033 to F-038), all medium or low. Tests are thin: one file with three happy-path assertions on pricing helpers. Checkout, refunds, the webhook, session and signup have no tests. Defects a test would have caught are the sales report counting only "paid" orders (not shipped), partial refunds marking the order fully refunded, and a client/server password rule mismatch (8 vs 10). External responses are cast without validation. No ESLint, Prettier, CI or hooks exist. `strict` is on and no `@ts-ignore` appears. I found no skipped or focused tests and no meaningful dead code. Duplicated shipping quoting is already in F-022. I read all the money, authentication and write-path files. I only sampled UI components such as ProductSearch and ProductCard. |
| production | done | 6 examined, 1 partly, 1 not examined, 0 not reported | Examined config, logging, monitoring, health, Dockerfile, in-memory state and outbound-call timeouts, and filed 7 items: no logging (F-039), no error tracking (F-040), no health endpoint and no retries (F-041), config not validated at start-up (F-042), unpinned Docker base and no CI or migration step (F-043), per-instance cache and no body limits (F-044), and a backups/monitoring/rollback question (F-045). Outbound calls all have timeouts. The Dockerfile is otherwise sound: multi-stage, non-root, lock-file install. I did not check graceful shutdown beyond relying on the standalone server defaults. PRD-08 does not apply because this is a web app. |
| api | done | 6 examined, 1 partly, 0 not examined, 0 not reported | Read all 10 route handlers and the validation schemas. Filed: cancel returning 200 on failures, inconsistent error shapes (plain-text vs JSON, no field names, unhandled malformed JSON), checkout with no idempotency key, unbounded or unpageable lists, whole-ORM-row responses, and a question about API consumers and versioning/contract. Not re-filed: GET that deletes (F-008) and webhook error swallowing (F-012). Static review only. |
| performance | done | 6 examined, 1 partly, 0 not examined, 0 not reported | Read all routes, pages, components and lib files relevant to performance. Filed: uncached shipping rates (F-052), raw img tags/no lazy loading/CLS (F-053), unmemoised search render (F-054), serial checkout steps (F-055), signup scrypt load (F-056), avatar memory bound (F-056→F-057 avatar, cache eviction F-058), and a question on production metrics (F-059). Already-filed issues (serial shipping calls F-023, N+1 F-027, unbounded product list F-049, effect loop F-016, report indexes F-025/F-026) were not repeated; PRF-07 is left to Data (DAT-02/03). Client bundle was assessed from source only (no build output), so PRF-03 is partly examined. |
| accessibility | done | 8 examined, 1 partly, 0 not examined, 0 not reported | I read all 13 UI components and pages, the layout and globals.css, and filed 7 findings: F-060 to F-066. None is high, because core tasks are technically reachable with a keyboard. The two most important are the global removal of the focus outline (F-060) and the placeholder-only labels on signup, search and shipping (F-061). I also filed a click-only sort span, silent status changes with no live region, a low-contrast #999 store name, page structure and title gaps, and missing alt text. Nothing was rendered, so touch-target sizes and the real tab order were judged from the code only. Findings that are good news: `lang="en"` is set, each page has one h1 and a main landmark, and the signup error uses role="alert". Nothing in the code suggests autoplaying media or animation, and no custom dialogs or widgets exist. I found no `user-scalable=no` in the code. I did not read the Next.js defaults for the viewport tag. |
| llm | done | 8 examined, 0 partly, 0 not examined, 0 not reported | The only LLM use is one OpenAI call in the product describe route (staff-only, gpt-4o-mini). I filed four items. F-067 covers prompt injection through review text. F-068 covers unchecked output, with no max_tokens or refusal handling. F-069 covers missing error handling, input caps and observability. F-070 is a question on provider retention and spend limits. The stored XSS (F-003) and the missing rate limits (F-009) were already filed, so I did not repeat them. There are no tools or agents, so tool agency is not applicable. The API key is server-side and was not seen in any NEXT_PUBLIC_ variable. |
| tenancy | done | 7 examined, 0 partly, 0 not examined, 0 not reported | Tenancy is a storeId column on User, Product and Order. The tenant comes from the signed session JWT, never from a body or query, and most routes filter by session.storeId. Not re-filed because they already exist: the catalog cache with no store in its key (F-017) and the sales report that aggregates every store (F-025, a cross-store read open to any staff user). I filed four low findings: order detail with no owner check (F-071), the product page with no store context (F-072), no RLS or cross-tenant tests, with writes by id alone (F-073), and no composite FKs, with no storeId on OrderItem or Review (F-074). TEN-05: the only cache is the in-process cache (F-017); there is no object storage or search index, and avatars live in the DB. TEN-06: the code has no background jobs, only an inline email send and one webhook, which looks orders up by a globally unique paymentId. Not checked: how stores are provisioned, and whether a store-switching flow exists (none was found). |

## What pins the result

- gitleaks: `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
- osv: `ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa`
- semgrep: `semgrep/semgrep@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b`
- Semgrep ruleset javascript: ccd47b2aeb2ff490520818ce956776b45ad701439f1e6221939bded1f53f242e (74 rules)
- Semgrep ruleset typescript: 6248ea7477e6da0db10305c0281f7cd908485691747f4fd641275145075f3b22 (74 rules)
- Semgrep ruleset react: a5c18c389e944cf760fd035a610ce9541259a3e515194cd7a265e715fe2b86db (4 rules)
- OSV queried at 2026-10-07T16:43:21.807Z
