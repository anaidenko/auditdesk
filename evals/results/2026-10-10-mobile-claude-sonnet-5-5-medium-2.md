# Eval: mobile, claude-sonnet-5-5 at medium

- **Date:** 2026-10-10T22:57:29.405Z
- **Fixture:** mobile, upstream `efa28320b2bbca2166c76a9b972a1e07902e26c0`, prepared `f894b551e03e7e40f919e590bebbe4fc0410177f`
- **Auditdesk:** `02c114d6c5ddfda3c03bfce2f10a6e1fccf495fb`; key digest `4fac99cd7699`; prices as of 2026-10-07
- **Aspects:** security, mobile
- **Access:** Claude plan (API-equivalent dollars, not billed)
- **Budget:** $3.00, 150,000 tokens
- **Duration:** 2 min 17 s; **calls:** 19; **cache-read share:** 76%

## Recall

**17 of 20** key entries found (85%); agents alone: 17 of 20.

| Entry | Item | Title | Found by |
| --- | --- | --- | --- |
| MOBX-01 | MOB-03 | App Transport Security is off for every connection, so product photos load over plain HTTP | F-006 |
| MOBX-02 | MOB-06 | Android permissions for contacts, the microphone and SMS that no code uses | F-007 |
| MOBX-03 | MOB-09 | The card-payment provider's server key ships in the app bundle, and the app charges cards with it | F-001 (scanner), F-011 |
| MOBX-04 | MOB-01 | Access and refresh tokens are kept in AsyncStorage instead of the Keychain or Keystore | F-005 |
| MOBX-05 | MOB-02 | Every API request is logged with its Authorization header and body, in release builds too | F-004 |
| MOBX-06 | MOB-05 | One-tap sign-in tokens travel through a custom scheme any app can claim, and any link signs the user in | F-005 |
| MOBX-07 | MOB-04 | The help WebView opens any URL a link gives it, hands that page the access token and follows its navigation messages | F-003 |
| MOBX-08 | MOB-08 | The app lock is a yes/no answer in JavaScript, and opens without a prompt when no biometrics are enrolled | F-008 |
| MOBX-09 | MOB-11 | Every analytics event sends the customer's email and precise location to a third party, without consent | F-009 |
| MOBX-10 | MOB-13 | Orders queued offline outlive a sign-out and are sent under the next customer's account | F-010 |
| MOBC-01 | MOB-03 | The shipped configuration loads the app from a development server over plain HTTP | F-015 |
| MOBC-02 | MOB-04 | Any page may load in the app's WebView, and help articles from other sites open there with the native bridge | F-012 |
| MOBC-03 | MOB-02 | The bridge logs its calls in release builds, the stored token among them | missed |
| MOBC-04 | MOB-01 | The session token is kept in Preferences, which Android also backs up | F-017 |
| MOBC-05 | MOB-06 | An exported broadcast receiver lets any app set the signed-in technician's token | F-013 |
| MOBC-06 | MOB-07 | Always-on location, contacts and background modes the app never uses, with descriptions that do not say why | F-018 |
| MOBC-07 | MOB-05 | A job link completes the job as soon as it opens, with no check and no confirmation | F-014 |
| MOBC-08 | MOB-12 | Seven taps on the version sign anyone in as the support technician, in release builds, with its password in the code | missed |
| MOBC-09 | MOB-13 | An offline report replaces the whole job when it is sent, and outlives a sign-out | missed |
| MOBC-10 | MOB-08 | The unlock PIN is stored as plain text and checked on the device, with no limit on attempts | F-017 |

Located under another item (not counted as found):

- F-002 on MOBX-03 (MOB-09), filed under SEC-03

## Findings outside the key

**False findings: 1**, and 1 filed beside a key entry under another item, unresolved, unless the judge or a review says otherwise.

- F-016 (MOB-12, capacitor-app/src/pages/Settings.tsx:19-49): Hidden support sign-in with hardcoded credentials in release build

On known issues (neither found nor false): F-019.
Questions outside the key: 0.

## Cost

| Model | Calls | Cost |
| --- | --- | --- |
| claude-sonnet-5-5 | 19 | $0.42 |

Agents: $0.42.

## Agents

| Aspect | Status | Coverage | Summary or note |
| --- | --- | --- | --- |
| security (expo-app) | done | 3 examined, 7 partly, 5 not examined, 0 not reported | Reviewed the client-only Expo app: api, session, links, payments, help WebView and checkout. I did not read login.tsx, unlock.tsx, analytics.ts, outbox.ts or biometrics.ts. There is no back end in this repo, so the server-side items could not be examined. Filed F-002 to F-005. F-001 was already filed. |
| mobile (expo-app) | done | 6 examined, 7 partly, 0 not examined, 0 not reported | Examined app.json, config, session, biometrics, analytics, outbox. Filed ATS/cleartext, Android permissions, biometric lock, analytics privacy, offline queue and bundle key findings. Deep links and storage were already filed (F-003, F-005). The native Android/iOS projects don't exist (managed Expo), so MOB-12, MOB-10 and MOB-06 are only partly covered. No EAS Update config was found. |
| security (capacitor-app) | done | 2 examined, 6 partly, 7 not examined, 0 not reported | Reviewed api.ts, auth.ts, pin.ts, Help.tsx. No back end in repo, so server-side items are not applicable. One finding filed (unvalidated URL navigation). Token and PIN storage in Preferences left for the Mobile app aspect. Other pages and queue.ts not read, for budget. |
| mobile (capacitor-app) | done | 6 examined, 5 partly, 2 not examined, 0 not reported | Read the Capacitor config, both platform manifests, the services and App.tsx. Seven findings filed. Native code was reviewed only for its bridge surface (JobSyncReceiver). Several items were only partly examined: MOB-08 is covered inside the storage finding, and MOB-13 is partly covered by it. MOB-02 (the snapshot, the logging setting) and MOB-09 (VITE_API_URL has a default but it was not otherwise checked) were skimmed. MOB-10 and MOB-11 were not checked beyond the config; package.json and the other pages were not read in full. |

## What pins the result

- gitleaks: `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
- osv: `ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa`
- semgrep: `semgrep/semgrep@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b`
- Semgrep ruleset javascript: e65e8449157ef5d587f2c2a0c17ed388910ca90336e514d27941ccd25543cf4e (74 rules)
- Semgrep ruleset typescript: 63fbcca1826e787ca43282bf139ccec16745ad6551c87850b9ccee9ca9f98c0b (74 rules)
- Semgrep ruleset react: feffd1ac057188bf075c916fc19108d314ec3c4b6080b46d68613ef320c911d4 (4 rules)
- OSV queried at 2026-10-10T22:57:34.810Z
