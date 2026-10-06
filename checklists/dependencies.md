# Dependencies and supply chain

Examine the manifests and lock files as text: nothing is installed, and you cannot reach the
registry. osv-scanner's known vulnerabilities are already filed under DEP-01. Report an
abandoned or deprecated package only from what the repository shows or what is widely
documented (`request`, deprecated since 2020); when you are unsure, file a question.

Severity: grade a vulnerable package by what reaches production. A package the server or the
browser bundle runs takes its advisory's severity; one used only at build time, in tests or in
local tooling is at most low. An abandoned package is medium when it handles users' input
(parsing, authentication, uploads), low otherwise. An install script, a dependency fetched from a
git URL or a tarball, or a lock file out of step with its manifest is medium.

## DEP-01 Known vulnerabilities

The scanner's dependency findings are filed. For each, check whether the package ships: a
`dependencies` entry that server or client code imports, or a package reached only through
tooling (the bundler, the test runner, a framework's dev server, `devDependencies`). When the
scanner's severity overstates the risk because the package does not ship, report one low
finding that names the scanner findings by ID and shows why (the manifest entry, the chain that
pulls the package in), so the auditor can lower them. When it understates the risk (the
vulnerable function is called with users' input), report that with the call site.

## DEP-02 Lock files

A lock file is committed for the package manager in use, and only one package manager is in
use (no `package-lock.json` beside `pnpm-lock.yaml` or `yarn.lock`). The lock file agrees with
the manifest. CI installs from it (`npm ci`, `pnpm install --frozen-lockfile`,
`yarn install --immutable`).

## DEP-03 Version ranges and sources

`*`, `latest`, `>=` or `x` ranges on production dependencies; dependencies from git, GitHub,
tarball URLs or `file:` paths; `overrides` or `resolutions` that pin a vulnerable version or hide
a conflict without a note.

## DEP-04 Abandoned and deprecated packages

Packages deprecated by their authors (`request`, `node-sass`, `tslint`, `protractor`), libraries
the framework replaced (`@angular/http`, Cordova plugins in a Capacitor app), and packages far
behind their current major with no upgrade path in sight. Name the evidence for each.

## DEP-05 Runtime and framework versions

Node.js declared the same way everywhere (`engines`, `.nvmrc`, Dockerfiles, CI) and still
supported; framework majors (Angular, Ionic, React, Next.js, NestJS, Express) still supported;
TypeScript and the build tools in step with the framework.

## DEP-06 Install scripts and native code

`preinstall`, `install` and `postinstall` scripts in the project's own manifests, packages known
to run install scripts, native add-ons built with node-gyp, binaries downloaded at install time.

## DEP-07 Registry configuration

`.npmrc` and `.yarnrc.yml`: a registry other than the default, auth tokens committed (also a
secret, SEC-10), `ignore-scripts`, scoped registries. Internal package names without a scope that
a public package of the same name could replace (dependency confusion).

## DEP-08 Weight and duplication

Several libraries for one job (moment, dayjs and date-fns; two HTTP clients; two state
libraries), heavy packages shipped to the browser for a small use (a whole `lodash` import),
`@types/*` and build tools in production dependencies.
