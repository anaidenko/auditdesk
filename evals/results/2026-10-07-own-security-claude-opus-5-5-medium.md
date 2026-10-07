# Eval: own, claude-opus-5-5 at medium

- **Date:** 2026-10-07T06:39:43.480Z
- **Fixture:** own, upstream `2aff7d01594473443eda3d072e40c0099e098d0f`, prepared `2ee228e951fad080046424c7813ac2a1e61ec57d`
- **Auditdesk:** `0f36ca80aab1657cc5d74bdfc8d6291f127572bf`; key digest `7038573172a6`; prices as of 2026-10-07
- **Aspects:** security
- **Access:** Claude plan (API-equivalent dollars, not billed)
- **Budget:** $3.00, 400,000 tokens
- **Duration:** 2 min 54 s; **calls:** 9; **cache-read share:** 81%

## Recall

**7 of 8** key entries found (88%); agents alone: 7 of 8.

| Entry | Item | Title | Found by |
| --- | --- | --- | --- |
| OWN-01 | SEC-03 | Any signed-in customer can read another customer's order by its ID | F-006 |
| OWN-02 | SEC-03 | Any signed-in user, customers included, can delete products: only the page hides the button | F-003 |
| OWN-03 | SEC-05 | Product descriptions are rendered as raw HTML | F-007 |
| OWN-04 | SEC-07 | The avatar endpoint fetches any URL a user gives it, from the server | F-008 |
| OWN-05 | SEC-10 | The shipping API secret is shipped to every browser | F-004 |
| OWN-21 | LLM-01 | Customer reviews reach the description prompt, where they can carry instructions | missed |
| OWN-24 | TEN-03 | Staff of any store see the whole platform's revenue | F-005 |
| OWN-25 | TEN-05 | The top-products cache is shared by every store | F-010 |

Located under another item (not counted as found):

- F-009 on OWN-07 (DEP-06), filed under SEC-15
- F-011 on OWN-04 (SEC-07), filed under SEC-12
- F-011 on OWN-23 (LLM-04), filed under SEC-12
- F-014 on OWN-11 (ARC-03), filed under SEC-09
- F-014 on OWN-15 (QUA-02), filed under SEC-09

## Findings outside the key

**False findings: 0**, and 3 filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.


On known issues (neither found nor false): F-012, F-013.
Questions outside the key: 1.
Outside this run's aspects, not graded: F-001, F-002.

## Cost

| Model | Calls | Cost |
| --- | --- | --- |
| claude-opus-5-5 | 9 | $0.75 |

Agents: $0.75.

## Agents

| Aspect | Status | Coverage | Summary or note |
| --- | --- | --- | --- |
| security | done | 12 examined, 3 partly, 0 not examined, 0 not reported | I read every source and config file in the repository and filed 13 new findings, F-003 to F-015. **Critical (2)** - F-003: any signed-in customer can call the `deleteProduct` Server Action and delete their store's products. It checks login but not role. - F-004: the shipping API secret reaches every browser through a `NEXT_PUBLIC_` variable. **High (5)** - F-005: the sales report has no store filter, so staff of any store see platform-wide revenue. - F-006: a customer can read another customer's order if they know its ID. - F-007: stored XSS. Customer reviews go into the AI description prompt, and the generated HTML is rendered without sanitising. - F-008: the avatar endpoint fetches any URL the user gives (SSRF). - F-009: `postinstall` downloads a remote script and pipes it to `sh` on every install, including the Docker build. **Medium (2)** - F-010: the top-products cache key leaves out the store, so stores show each other's products. - F-011: no rate limiting anywhere. **Low (3)** - F-012: no security headers. - F-013: 7-day sessions that can't be revoked. - F-014: the payment webhook has no replay protection, no schema check, and swallows errors. **Question (1)** - F-015: no login, password-reset or role-assignment code exists in this repo. **Checked, nothing filed** - Sessions: the JWT algorithm is pinned and the cookie flags are good. - Injection: the only raw SQL is a parameterised `$queryRaw`, and I found no eval or command execution. - CSRF: SameSite=Lax cookies, JSON bodies and Next.js's own origin check on Server Actions cover it. - Logging: the app writes no logs. - Cryptography: scrypt, `randomBytes` and a constant-time HMAC comparison are all sound. **Partly examined** - SEC-01: the login and reset flows the item covers are not in the repo (F-015). - SEC-08: there is no real file-upload path. The avatar endpoint only fetches a URL, which is covered under SEC-07 and SEC-12. - SEC-15: no Semgrep results came back. |

## What pins the result

- gitleaks: `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
- osv: `ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa`
- semgrep: `semgrep/semgrep@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b`
- Semgrep ruleset javascript: ccd47b2aeb2ff490520818ce956776b45ad701439f1e6221939bded1f53f242e (74 rules)
- Semgrep ruleset typescript: 63fbcca1826e787ca43282bf139ccec16745ad6551c87850b9ccee9ca9f98c0b (74 rules)
- Semgrep ruleset react: feffd1ac057188bf075c916fc19108d314ec3c4b6080b46d68613ef320c911d4 (4 rules)
- OSV queried at 2026-10-07T06:39:45.114Z
