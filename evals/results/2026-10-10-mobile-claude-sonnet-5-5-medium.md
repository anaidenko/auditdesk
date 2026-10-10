# Eval: mobile, claude-sonnet-5-5 at medium

- **Date:** 2026-10-10T22:26:27.474Z
- **Fixture:** mobile, upstream `1cff1c3e2dd1082106aba62a27a952c2c9a3a880`, prepared `9c1ca7b30ef0d5ca2f29ca38ef77baff659a3a7b`
- **Auditdesk:** `4d045c3994552d17d29107f311629f7b70237957`; key digest `7b2d97385313`; prices as of 2026-10-07
- **Aspects:** security, mobile
- **Access:** Claude plan (API-equivalent dollars, not billed)
- **Budget:** $3.00, 150,000 tokens
- **Duration:** 2 min 5 s; **calls:** 21; **cache-read share:** 78%

## Recall

**14 of 20** key entries found (70%); agents alone: 14 of 20.

| Entry | Item | Title | Found by |
| --- | --- | --- | --- |
| MOBX-01 | MOB-03 | App Transport Security is off for every connection, so product photos load over plain HTTP | F-006 |
| MOBX-02 | MOB-06 | Android permissions for contacts, the microphone and SMS that no code uses | F-007 |
| MOBX-03 | MOB-09 | The card-payment provider's server key ships in the app bundle, and the app charges cards with it | F-001 (scanner), F-004 |
| MOBX-04 | MOB-01 | Access and refresh tokens are kept in AsyncStorage instead of the Keychain or Keystore | F-005 |
| MOBX-05 | MOB-02 | Every API request is logged with its Authorization header and body, in release builds too | F-003 |
| MOBX-06 | MOB-05 | One-tap sign-in tokens travel through a custom scheme any app can claim, and any link signs the user in | missed |
| MOBX-07 | MOB-04 | The help WebView opens any URL a link gives it, hands that page the access token and follows its navigation messages | missed |
| MOBX-08 | MOB-08 | The app lock is a yes/no answer in JavaScript, and opens without a prompt when no biometrics are enrolled | F-010 |
| MOBX-09 | MOB-11 | Every analytics event sends the customer's email and precise location to a third party, without consent | F-008 |
| MOBX-10 | MOB-13 | Orders queued offline outlive a sign-out and are sent under the next customer's account | F-009 |
| MOBC-01 | MOB-03 | The shipped configuration loads the app from a development server over plain HTTP | F-014 |
| MOBC-02 | MOB-04 | Any page may load in the app's WebView, and help articles from other sites open there with the native bridge | missed |
| MOBC-03 | MOB-02 | The bridge logs its calls in release builds, the stored token among them | missed |
| MOBC-04 | MOB-01 | The session token is kept in Preferences, which Android also backs up | F-016 |
| MOBC-05 | MOB-06 | An exported broadcast receiver lets any app set the signed-in technician's token | F-013 |
| MOBC-06 | MOB-07 | Always-on location, contacts and background modes the app never uses, with descriptions that do not say why | F-017 |
| MOBC-07 | MOB-05 | A job link completes the job as soon as it opens, with no check and no confirmation | F-015 |
| MOBC-08 | MOB-12 | Seven taps on the version sign anyone in as the support technician, in release builds, with its password in the code | missed |
| MOBC-09 | MOB-13 | An offline report replaces the whole job when it is sent, and outlives a sign-out | F-016 |
| MOBC-10 | MOB-08 | The unlock PIN is stored as plain text and checked on the device, with no limit on attempts | missed |

Located under another item (not counted as found):

- F-002 on MOBX-07 (MOB-04), filed under SEC-15
- F-011 on MOBC-02 (MOB-04), filed under SEC-05
- F-012 on MOBC-10 (MOB-08), filed under SEC-01

## Findings outside the key

**False findings: 0**, and 3 filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.


On known issues (neither found nor false): F-018.
Questions outside the key: 0.

## Cost

| Model | Calls | Cost |
| --- | --- | --- |
| claude-sonnet-5-5 | 21 | $0.40 |

Agents: $0.40.

## Agents

| Aspect | Status | Coverage | Summary or note |
| --- | --- | --- | --- |
| security (expo-app) | done | 9 examined, 4 partly, 2 not examined, 0 not reported | Reviewed api, links, help, config and payments. Filed three findings: WebView token leak via deep link, token logging, and the payment key in the client. I did not review the other screens, analytics or outbox in depth. Session storage in AsyncStorage and the http image base belong to the Mobile app aspect. |
| mobile (expo-app) | done | 6 examined, 5 partly, 2 not examined, 0 not reported | Reviewed the session, biometrics, outbox, analytics and config files and app.json. Filed 6 findings: tokens in AsyncStorage, ATS disabled, excess Android permissions, analytics privacy, a weak biometric lock, and the offline queue. I did not read the screens or the payments, API and links files in full. Existing findings cover the bundled secrets, deep link and logging. No privacy manifest is declared, which is noted only here. No OTA, EAS or release-build config exists in the repo, so those items are unexamined. |
| security (capacitor-app) | done | 2 examined, 10 partly, 3 not examined, 0 not reported | Small Ionic client with no server code. Reviewed api, auth, Help, JobDetail, Lock. Filed two findings (unvalidated URL navigation, weak PIN lock). Token storage left to the Mobile app aspect. Did not read queue.ts, Settings, Login, Jobs or App in detail. |
| mobile (capacitor-app) | done | 6 examined, 7 partly, 0 not examined, 0 not reported | Filed 6 findings (F-013 to F-018). Native code was read for its bridge surface only. I did not examine OTA updates, SDK consent or biometrics in depth, since the repo has none. MOB-02 was covered only through the logging setting and allowBackup. |

## What pins the result

- gitleaks: `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
- osv: `ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa`
- semgrep: `semgrep/semgrep@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b`
- Semgrep ruleset javascript: ccd47b2aeb2ff490520818ce956776b45ad701439f1e6221939bded1f53f242e (74 rules)
- Semgrep ruleset typescript: 6248ea7477e6da0db10305c0281f7cd908485691747f4fd641275145075f3b22 (74 rules)
- Semgrep ruleset react: a5c18c389e944cf760fd035a610ce9541259a3e515194cd7a265e715fe2b86db (4 rules)
- OSV queried at 2026-10-10T22:26:30.639Z
