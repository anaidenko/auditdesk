# Eval: own, claude-sonnet-5-5 at high

- **Date:** 2026-10-07T07:00:00.000Z
- **Aspects:** security
- **Access:** Claude plan (API-equivalent dollars, not billed)
- **Duration:** 1 min 42 s; **calls:** 12; **cache-read share:** 85%

## Recall

**6 of 8** key entries found (75%); agents alone: 6 of 8.

## Findings outside the key

**False findings: 1** by the judge's verdicts, of 2 it was given.

- F-004 (SEC-04, src/db.ts:5): Raw SQL in the order export — judge: false; The query is parameterised.
- F-009 (SEC-03, src/app/api/orders/[id]/route.ts:9): Order read without an owner check — judge: matches_key OWN-01; The same IDOR, cited one line lower.

Judge: 2 verdicts: 1 matches_key, 1 false. Cost $0.02.

## Cost

Agents: $0.27.
