# Eval: own, claude-sonnet-5-5 at low

- **Date:** 2026-10-07T06:35:56.719Z
- **Fixture:** own, upstream `2aff7d01594473443eda3d072e40c0099e098d0f`, prepared `2ee228e951fad080046424c7813ac2a1e61ec57d`
- **Auditdesk:** `0f36ca80aab1657cc5d74bdfc8d6291f127572bf`; key digest `7038573172a6`; prices as of 2026-10-07
- **Aspects:** security
- **Access:** Claude plan (API-equivalent dollars, not billed)
- **Budget:** $3.00, 400,000 tokens
- **Duration:** 53 s; **calls:** 6; **cache-read share:** 76%

## Recall

**5 of 8** key entries found (63%); agents alone: 5 of 8.

| Entry | Item | Title | Found by |
| --- | --- | --- | --- |
| OWN-01 | SEC-03 | Any signed-in customer can read another customer's order by its ID | missed |
| OWN-02 | SEC-03 | Any signed-in user, customers included, can delete products: only the page hides the button | F-007 |
| OWN-03 | SEC-05 | Product descriptions are rendered as raw HTML | F-005 |
| OWN-04 | SEC-07 | The avatar endpoint fetches any URL a user gives it, from the server | F-004 |
| OWN-05 | SEC-10 | The shipping API secret is shipped to every browser | F-006 |
| OWN-21 | LLM-01 | Customer reviews reach the description prompt, where they can carry instructions | missed |
| OWN-24 | TEN-03 | Staff of any store see the whole platform's revenue | F-007 |
| OWN-25 | TEN-05 | The top-products cache is shared by every store | missed |

Located under another item (not counted as found):

- F-003 on OWN-07 (DEP-06), filed under SEC-15
- F-008 on OWN-23 (LLM-04), filed under SEC-12

## Findings outside the key

**False findings: 0**, and 2 filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.


On known issues (neither found nor false): F-009.
Questions outside the key: 0.
Outside this run's aspects, not graded: F-001, F-002.

## Cost

| Model | Calls | Cost |
| --- | --- | --- |
| claude-sonnet-5-5 | 6 | $0.17 |

Agents: $0.17.

## Agents

| Aspect | Status | Coverage | Summary or note |
| --- | --- | --- | --- |
| security | done | 11 examined, 4 partly, 0 not examined, 0 not reported | Reviewed all routes, session, payments, and key components. Filed 7 findings. Not examined: no login route found; orders list, email, shipping and Dockerfile were not read. |

## What pins the result

- gitleaks: `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
- osv: `ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa`
- semgrep: `semgrep/semgrep@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b`
- Semgrep ruleset javascript: ccd47b2aeb2ff490520818ce956776b45ad701439f1e6221939bded1f53f242e (74 rules)
- Semgrep ruleset typescript: 63fbcca1826e787ca43282bf139ccec16745ad6551c87850b9ccee9ca9f98c0b (74 rules)
- Semgrep ruleset react: feffd1ac057188bf075c916fc19108d314ec3c4b6080b46d68613ef320c911d4 (4 rules)
- OSV queried at 2026-10-07T06:35:58.346Z
