# Mobile app

When the repository is a mobile app built with Capacitor, Cordova, React Native or Expo. Read the
app's TypeScript and JavaScript, and its platform configuration as text: `capacitor.config.*`,
Cordova's `config.xml`, `app.json` and `app.config.*` (Expo), `Info.plist`, entitlements,
`PrivacyInfo.xcprivacy`, `AndroidManifest.xml`, `network_security_config.xml` and the Gradle
files. Native code (Swift, Objective-C, Kotlin and Java) is read for its bridge surface only: the
methods of a plugin or native module that JavaScript can call, and what they trust from it
(arguments, URLs, origins). The rest of the native code is not reviewed; mark an item that would
need it "partly" and say so in the summary.

On a mobile app, what is specific to the device is filed here, not under Security: tokens and
secrets stored on the device, keys compiled into the app, the app's transport settings, the
WebView and its bridge, deep links, the app's lock, and what a release build logs or sends to
analytics. Injection in the app's own code stays Security's, and so do the back end's routes. In
a repository of the project that is not a mobile app, such as its API, report nothing here and
mark every item not examined.

Severity: critical when anyone who installs the app, or any app or website, can exploit it now
with serious impact (a server's secret key in the bundle, a deep link that acts for the signed-in
user, credentials sent in cleartext). High when it needs modest preconditions: a network the
attacker controls, a malicious app on the same device, a few minutes with an unlocked phone, or
when it harms some users. Medium needs unusual conditions (a rooted device, a backup the attacker
holds) or has limited impact. Low is defence in depth or hygiene.

## MOB-01 Secrets and tokens at rest

Where the app keeps access and refresh tokens, passwords, PINs and personal data. AsyncStorage,
`@capacitor/preferences`, `localStorage`, Ionic Storage and plain SQLite are files that a backup
or a rooted device reads; secrets belong in the Keychain or the Keystore (`expo-secure-store`,
`react-native-keychain`, a secure-storage plugin). What logout clears: tokens, cached personal
data and the secure store's entries.

MASVS controls: MASVS-STORAGE-1.

## MOB-02 Leaks from the device

Tokens, passwords or personal data in `console.log` calls that a release build keeps (React
Native keeps them unless a Babel plugin removes them; Capacitor's `loggingBehavior:
"production"` logs the bridge's traffic in release builds) and in crash reports (personal data
sent to analytics is MOB-11's); sensitive values copied to the clipboard; Android
`android:allowBackup="true"` without backup rules for an app that holds tokens in plain files; sensitive screens left in the app
switcher's snapshot or a screen recording; sensitive data in notifications on the lock screen.

MASVS controls: MASVS-STORAGE-2, MASVS-PLATFORM-3.

## MOB-03 Transport

iOS App Transport Security exceptions (`NSAllowsArbitraryLoads`,
`NSExceptionAllowsInsecureHTTPLoads`); Android cleartext (`android:usesCleartextTraffic="true"`,
a network security config that permits cleartext or trusts user-added certificates in a release
build); Capacitor's `server.cleartext`, and a `server.url` that points the shipped app at a
development server; `http://` URLs for the app's own API; certificate checks turned off in an
HTTP plugin or a native module. Certificate pinning only where the brief's risk calls for it
(payments, health, banking): elsewhere its absence is low, and a pin with no backup pin or
rotation plan is a finding of its own.

MASVS controls: MASVS-NETWORK-1, MASVS-NETWORK-2.

## MOB-04 WebView and the bridge

Capacitor's `server.allowNavigation` with wildcards; Cordova's `<access origin="*">`,
`<allow-navigation href="*">` and a missing or permissive Content-Security-Policy; React Native
WebView's `originWhitelist={["*"]}`, `allowFileAccess`, `allowUniversalAccessFromFileURLs` and
`injectedJavaScript` that hands a token to the page. Remote or third-party content loaded where
it can reach the native bridge (Capacitor plugins, `window.ReactNativeWebView.postMessage`,
Cordova's `exec`); `onMessage` and `message` handlers that act on a message without checking its
origin and shape. A plugin's or native module's bridge methods that do more than the app's own
JavaScript should be able to ask (any URL, any file path, any SQL).

MASVS controls: MASVS-PLATFORM-2.

## MOB-05 Deep links

Custom URL schemes (`myapp://`), which any app can register and intercept, against verified
links: iOS universal links with `apple-app-site-association`, Android App Links with
`android:autoVerify="true"` and `assetlinks.json`. Handlers (`App.addListener("appUrlOpen")`,
`Linking.addEventListener`, Expo Router's routes, Cordova's `handleOpenURL`) that navigate to
any path, sign the user in, accept a token, or act (pay, delete, change a setting) on a link's
parameters without validating them or asking the user. OAuth redirects through a custom scheme
without PKCE, which another app can catch.

MASVS controls: MASVS-PLATFORM-1, MASVS-CODE-4.

## MOB-06 Android components and permissions

In `AndroidManifest.xml`: activities, services, receivers and providers exported
(`android:exported="true"`, or an intent filter on an old target) without a permission;
permissions the code never uses, or broader than it needs (fine location for a city, all files
for a photo picker); `android:debuggable="true"`; a `minSdkVersion` or `targetSdkVersion` far
behind the current platform (the Gradle files, `app.json`'s `android`, `expo-build-properties`).

MASVS controls: MASVS-PLATFORM-1, MASVS-PRIVACY-1, MASVS-RESILIENCE-4, MASVS-CODE-1.

## MOB-07 iOS configuration

In `Info.plist`, entitlements and `app.json`'s `ios`: usage descriptions
(`NSCameraUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`) for features the
code does not use, or that do not say why; background modes (`UIBackgroundModes`) the app does
not need; entitlements broader than its features (associated domains, keychain and app groups);
a privacy manifest (`PrivacyInfo.xcprivacy`, Expo's `ios.privacyManifests`) that is missing or
does not declare the required-reason APIs the app uses (`UserDefaults`, file timestamps, disk
space, system boot time), the data it collects, or its tracking domains.

MASVS controls: MASVS-PRIVACY-1, MASVS-PRIVACY-3.

## MOB-08 Authentication on the device

Biometrics used as a yes/no answer in JavaScript (`authenticateAsync()` and then `if (success)`),
which a patched app skips, instead of a secret the Keychain or Keystore releases only after the
prompt (`expo-secure-store` with `requireAuthentication`, `react-native-keychain` with
`accessControl`); a PIN checked against a value stored on the device; sessions that never expire
and are not re-checked when the app returns from the background; sensitive actions (a payment, a
password or email change, a data export) without fresh authentication, which leaves them to
anyone holding the unlocked phone.

MASVS controls: MASVS-AUTH-1, MASVS-AUTH-2, MASVS-AUTH-3.

## MOB-09 Secrets in the bundle

Anyone who downloads the app can read its JavaScript bundle and resources: `EXPO_PUBLIC_*`
variables, `react-native-config` and bundled `.env` files, `app.json`'s `extra`, an
`environment.ts`. A server's secret there (a payment provider's secret key, an admin or
service-role token, a private API's key) has no place in an app. Firebase and Google Maps keys
are public by design: ask whether they are restricted (to the app's signature or bundle ID, to
the APIs it uses) rather than report them.

MASVS controls: MASVS-STORAGE-1.

## MOB-10 Updates and integrity

Over-the-air updates (EAS Update, Capgo, Appflow Live Updates, CodePush): verified where the
service offers it (EAS Update's code signing), on channels that keep a test bundle out of
production, with a way back from a bad update. A forced-update path for a release that must be
withdrawn: a minimum version the API or a remote configuration checks, and a screen that sends the
user to the store. Native plugins and modules that are abandoned or far behind the platform (a
Cordova plugin in a Capacitor app with an official replacement). Known vulnerabilities in
packages are DEP-01's.

MASVS controls: MASVS-CODE-2, MASVS-CODE-3.

## MOB-11 Third-party SDKs and consent

Analytics, advertising, attribution and crash SDKs: what each collects, and what personal data
the code hands them (an email as the user ID, a precise location, health data in an event);
tracking that starts before consent; on iOS, tracking or the advertising identifier without App
Tracking Transparency; identifiers that link a user across apps where a random ID would do; a
way for the user to see, delete and stop sharing their data.

MASVS controls: MASVS-PRIVACY-1, MASVS-PRIVACY-2, MASVS-PRIVACY-3, MASVS-PRIVACY-4.

## MOB-12 Release build

Debug code kept out of a release build: developer menus and debug screens, test accounts, a
switch to a mock API, checks of `__DEV__` turned the wrong way; source maps uploaded to the crash
tracker, not shipped in the app or served publicly; R8 or ProGuard on for the release build
(`minifyEnabled`); signing keys, keystores and their passwords out of the repository and
`gradle.properties` (gitleaks covers the files; this item covers the process, often a question:
who signs a store build, and where the keys live). Build flavours, crash reporting and API URLs
per build are PRD-08's.

MASVS controls: MASVS-RESILIENCE-3, MASVS-RESILIENCE-4.

## MOB-13 Offline data and sync

Changes made offline are queued so that they survive the app being killed, and are never sent
under the next user's account after a logout; conflicts are resolved by a rule the code states (a
version check, last write wins, a merge), not by whichever request lands last; one user's cached
data and queued requests never show or go out after another user signs in on the same device.

MASVS controls: MASVS-STORAGE-1.

## MOB-14 Gaps typical of generated code (AI-built)

Tokens and user data in AsyncStorage or `@capacitor/preferences` because the example did so; keys
and service-role tokens in `EXPO_PUBLIC_*` variables or `app.json`; permissions and usage
descriptions copied from a template for features the app does not have; WebView and network
settings left at their most open (`originWhitelist={["*"]}`, cleartext everywhere,
`allowNavigation: ["*"]`); deep-link handlers that trust every parameter.
