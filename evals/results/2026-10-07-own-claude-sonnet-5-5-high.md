# Eval: own, claude-sonnet-5-5 at high

- **Date:** 2026-10-07T06:46:21.403Z
- **Fixture:** own, upstream `2aff7d01594473443eda3d072e40c0099e098d0f`, prepared `2ee228e951fad080046424c7813ac2a1e61ec57d`
- **Auditdesk:** `8146a1012cb43a84b4f65575108494f433a18bb4`; key digest `7038573172a6`; prices as of 2026-10-07
- **Aspects:** security, dependencies, architecture, data, quality, production, llm, tenancy
- **Access:** Claude plan (API-equivalent dollars, not billed)
- **Budget:** $8.00, 400,000 tokens
- **Duration:** 8 min 53 s; **calls:** 59; **cache-read share:** 83%

## Recall

**18 of 25** key entries found (72%); agents alone: 18 of 25.

| Entry | Item | Title | Found by |
| --- | --- | --- | --- |
| OWN-01 | SEC-03 | Any signed-in customer can read another customer's order by its ID | missed |
| OWN-02 | SEC-03 | Any signed-in user, customers included, can delete products: only the page hides the button | F-003 |
| OWN-03 | SEC-05 | Product descriptions are rendered as raw HTML | F-004 |
| OWN-04 | SEC-07 | The avatar endpoint fetches any URL a user gives it, from the server | F-006 |
| OWN-05 | SEC-10 | The shipping API secret is shipped to every browser | F-005 |
| OWN-06 | DEP-04 | The request package is deprecated and unmaintained | F-013 |
| OWN-07 | DEP-06 | npm install downloads and runs a remote script | missed |
| OWN-08 | DEP-02 | The lock file does not match package.json, so npm ci fails | F-012 |
| OWN-09 | ARC-01 | A presentational component queries the database for every card | missed |
| OWN-10 | ARC-03 | Order confirmation emails fail silently | F-018 |
| OWN-11 | ARC-03 | The payments webhook swallows errors and acknowledges lost refunds | F-015 |
| OWN-12 | DAT-02 | OrderItem.orderId has no index | F-023 |
| OWN-13 | DAT-03 | The order list queries each order's items separately | F-024 |
| OWN-14 | DAT-04 | Checkout writes the order, the stock and the payment outside one transaction | F-022 |
| OWN-15 | QUA-02 | The payments module, refunds included, has no tests | F-031 |
| OWN-16 | QUA-03 | The sign-up form accepts 8-character passwords the server rejects | missed |
| OWN-17 | PRD-04 | No health check for the platform to probe | F-038 |
| OWN-18 | PRD-01 | The payments secret is read when the module loads, so builds and tests need it | missed |
| OWN-19 | PRD-06 | Are the database and uploaded avatars backed up, and has a restore been tested? | F-042 |
| OWN-20 | PRD-03 | Who is alerted when checkout or the payments webhook starts failing? | missed |
| OWN-21 | LLM-01 | Customer reviews reach the description prompt, where they can carry instructions | F-044 |
| OWN-22 | LLM-03 | The model's HTML is saved unvalidated and later rendered raw | F-043 |
| OWN-23 | LLM-04 | The model call sets no output limit | F-045 |
| OWN-24 | TEN-03 | Staff of any store see the whole platform's revenue | F-048 |
| OWN-25 | TEN-05 | The top-products cache is shared by every store | missed |

Located under another item (not counted as found):

- F-002 on OWN-06 (DEP-04), filed under DEP-01
- F-007 on OWN-07 (DEP-06), filed under SEC-15
- F-008 on OWN-04 (SEC-07), filed under SEC-12
- F-008 on OWN-23 (LLM-04), filed under SEC-12
- F-014 on OWN-14 (DAT-04), filed under ARC-06
- F-014 on OWN-15 (QUA-02), filed under ARC-06
- F-016 on OWN-25 (TEN-05), filed under ARC-02
- F-017 on OWN-16 (QUA-03), filed under ARC-07
- F-020 on OWN-05 (SEC-10), filed under ARC-04
- F-020 on OWN-10 (ARC-03), filed under ARC-04
- F-020 on OWN-15 (QUA-02), filed under ARC-04
- F-020 on OWN-18 (PRD-01), filed under ARC-04
- F-021 on OWN-05 (SEC-10), filed under ARC-01
- F-025 on OWN-24 (TEN-03), filed under DAT-03
- F-026 on OWN-02 (SEC-03), filed under DAT-07
- F-027 on OWN-12 (DAT-02), filed under DAT-01
- F-032 on OWN-11 (ARC-03), filed under QUA-01
- F-032 on OWN-15 (QUA-02), filed under QUA-01
- F-033 on OWN-06 (DEP-04), filed under QUA-06
- F-033 on OWN-07 (DEP-06), filed under QUA-06
- F-034 on OWN-15 (QUA-02), filed under QUA-05
- F-035 on OWN-15 (QUA-02), filed under QUA-07
- F-036 on OWN-11 (ARC-03), filed under QUA-04
- F-037 on OWN-10 (ARC-03), filed under PRD-02
- F-037 on OWN-11 (ARC-03), filed under PRD-02
- F-039 on OWN-05 (SEC-10), filed under PRD-01
- F-039 on OWN-10 (ARC-03), filed under PRD-01
- F-041 on OWN-04 (SEC-07), filed under PRD-07
- F-041 on OWN-25 (TEN-05), filed under PRD-07
- F-046 on OWN-22 (LLM-03), filed under LLM-07
- F-046 on OWN-23 (LLM-04), filed under LLM-07

## Findings outside the key

**False findings: 5**, and 20 filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.

- F-011 (SEC-01, src/app/api/signup/route.ts:19-25): Signup reveals which emails are registered; no email verification
- F-019 (ARC-03, src/app/layout.tsx:5-11): No error boundaries; API routes have no shared error handling or response shape
- F-028 (DAT-08, prisma/schema.prisma:40): Avatar images stored as bytes on the User row, size check trusts a header
- F-029 (DAT-05, README.md:15-20): No production migration step; README and scripts only cover `migrate dev`
- F-049 (TEN-07, prisma/schema.prisma:67-107): Isolation relies on hand-written filters; no RLS, no cross-tenant tests

On known issues (neither found nor false): F-001, F-009, F-010, F-040.
Questions outside the key: 3.

## Cost

| Model | Calls | Cost |
| --- | --- | --- |
| claude-sonnet-5-5 | 59 | $1.55 |

Agents: $1.55.

## Agents

| Aspect | Status | Coverage | Summary or note |
| --- | --- | --- | --- |
| security | done | 13 examined, 2 partly, 0 not examined, 0 not reported | Reviewed all routes, server actions, session, payments, webhook, validation, config, Dockerfile and env example. Filed 9 findings (F-003 to F-011): missing role check on deleteProduct, stored XSS via LLM-generated HTML, NEXT_PUBLIC shipping secret, avatar SSRF, curl\|sh postinstall, no rate limiting, no session revocation, no security headers, signup enumeration. Sound areas: JWT verification pins HS256 with expiry and a strength check; scrypt hashing; webhook HMAC with timing-safe compare; parameterised raw SQL; cookie flags. Tenant scoping gaps (sales report without storeId, product page lookup without storeId, webhook update by paymentId) are left to the multi-tenancy aspect. No login or password-reset route exists in the repo, so those flows were not examined. |
| dependencies | done | 8 examined, 0 partly, 0 not examined, 0 not reported | Reported two findings: the lock file is out of step with the manifest (F-012), and the deprecated `request` library (F-013). F-013 also notes that F-002 is overstated, because the URL is fixed from an env var. The postinstall `curl \| sh` is already filed as F-007, so I did not repeat it. Node is consistent (engines >=22, .nvmrc 22, node:22 images). There is no .npmrc and no registry override, and all lock `resolved` URLs use registry.npmjs.org over HTTPS. There are no git, tarball or file: dependencies. I could not check the real next advisories against 15.3.2, because the lock records 15.1.0. CI config is absent, so I could not check how CI installs. The Dockerfile uses `npm ci`. |
| architecture | done | 7 examined, 1 partly, 0 not examined, 0 not reported | Read every route handler, server action, component and lib file in src. I filed 8 findings. The main ones are: checkout is not atomic and takes payment last; the payment webhook swallows errors; the in-memory cache key is not scoped per store; and the client and server validation rules have drifted apart. I also filed missing error boundaries, scattered config, a duplicated shipping quote and a fire-and-forget email. Not covered: ARC-05 (state is minimal; the cart lives in localStorage with no effects or subscriptions) and ARC-08 (no framework misuse beyond what is filed). I did not report the sales report's missing storeId filter, which belongs to the multi-tenancy aspect. |
| data | done | 8 examined, 0 partly, 0 not examined, 0 not reported | Reviewed the Prisma schema, the init migration and every route and server action that touches the database. The schema basics are sound: declared keys, unique (storeId,email), integer-cent money, timestamptz and enums. The init migration matches the schema. I filed 9 findings and 1 question: stock oversell with no guard or CHECK, a missing OrderItem.orderId index, the N+1 in the order list, an unscoped and unindexed sales report, product delete failing on RESTRICT FKs, missing CHECK constraints, avatar bytes stored on User, no production migrate step plus a non-idempotent seed, and a pooling question. The checkout transaction and idempotency problem is already F-014, so I did not repeat it. Row counts and real query plans can't be checked from code. |
| quality | done | 6 examined, 1 partly, 0 not examined, 0 not reported | Read all lib, API route, admin action and component files. Strict TypeScript is on, but boundary casts exist; only pricing has tests; no CI, linter or formatter; some hard-coded business rules and dead code. Duplication already filed as F-017/F-021 (client/server validation, shipping); price formatting repeated in three places was noted but not filed separately. |
| production | done | 8 examined, 0 partly, 0 not examined, 0 not reported | Filed 5 findings (no logging or error tracking; no health endpoint; environment not validated at start-up; Dockerfile and deploy gaps; in-memory cache and scaling) and 1 question (backups, alerting, staging and rollback, log destination). I did not re-file items already covered by F-005, F-007, F-012, F-015, F-016, F-020 and F-029. Outbound calls have timeouts but no retries. The app is a web app, so PRD-08 does not apply. I checked the Dockerfile and .dockerignore by reading them. I did not run a build or look at the CI configuration, because the repository has none. |
| llm | done | 8 examined, 0 partly, 0 not examined, 0 not reported | The only LLM call is the OpenAI product-description route. I filed five items: prompt injection via reviews (F-044), unchecked output and truncation (F-043), no cost limits (F-045), reliability and observability gaps (F-046), and a data-retention question (F-047). The model has no tools, so tool agency does not apply. The OPENAI_API_KEY is read by the SDK from the environment and is not public. I did not trace where reviews are written; no code creates them. |
| tenancy | done | 6 examined, 1 partly, 0 not examined, 0 not reported | Tenancy is a storeId column on User, Product and Order, with a per-store unique email; the store comes from the signed JWT session, not from client input. Most routes filter by session.storeId. Filed: the sales report raw SQL with no store filter (high, F-048); no defence in depth (no RLS, no cross-tenant tests, Review/OrderItem have no storeId) (F-049); and a question about the shared payments account (F-050). The cross-store cache (F-016) and the missing-index/N+1 issues were already filed, so I did not repeat them. Not tenancy findings: orders/[id] and the other routes let a customer read other customers' orders within one store (SEC-03 territory); the storefront picks the store from a public ?store= parameter, which is by design. I did not read email.ts or ProductCard, and there are no background jobs or file storage beyond the avatar bytes on the User row. |

## What pins the result

- gitleaks: `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
- osv: `ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa`
- semgrep: `semgrep/semgrep@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b`
- Semgrep ruleset javascript: ccd47b2aeb2ff490520818ce956776b45ad701439f1e6221939bded1f53f242e (74 rules)
- Semgrep ruleset typescript: 63fbcca1826e787ca43282bf139ccec16745ad6551c87850b9ccee9ca9f98c0b (74 rules)
- Semgrep ruleset react: feffd1ac057188bf075c916fc19108d314ec3c4b6080b46d68613ef320c911d4 (4 rules)
- OSV queried at 2026-10-07T06:46:23.036Z
