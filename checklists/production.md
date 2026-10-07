# Production readiness

What it takes to run the product safely. Much of it lives outside the code (hosting,
dashboards, alerts, runbooks): file what the code cannot show as a question (kind "question"),
never as a finding, and say what answer would settle it.

Severity: critical when data or money is being lost unnoticed now. High when an outage is
likely and nobody would see it in time (no health check behind a load balancer, in-memory state
behind several instances). Medium for gaps that slow detection or recovery (no error tracking,
logs without request IDs, no graceful shutdown, no timeouts on outbound calls). Low for
hygiene.

## PRD-01 Configuration and secrets

Every environment variable listed in an example file (`.env.example`) and validated at
start-up; secrets supplied by the platform or a secret manager; secrets read at import time,
which breaks builds and tests; one configuration per environment. A secret in the code, the
history, a bundle or an image is SEC-10's.

## PRD-02 Logging

Structured logs with levels; a request or correlation ID carried through; background jobs
logged too; where the logs go. Passwords, tokens or personal data in logs are SEC-13's.

## PRD-03 Error tracking and monitoring

An error tracker wired on the server and the client (Sentry or similar), source maps uploaded
to it and not served publicly, metrics; alerting and uptime checks (usually a question).

## PRD-04 Health and lifecycle

Health and readiness endpoints that check the database and other dependencies; graceful
shutdown on SIGTERM (stop accepting, finish in-flight work, close connections); timeouts on
every outbound call; retries with backoff and a limit.

## PRD-05 Build and deployment

Dockerfiles: multi-stage, a pinned base image, a non-root user, a `.dockerignore`. Builds
installed from the lock file; a CI/CD pipeline; migrations run as a deploy step, not at app
start on every instance; a staging environment and a way to roll back (often a question).

## PRD-06 Backups and recovery

Database backups, point-in-time recovery, a restore that has been tested, backups of uploaded
files. Almost always a question; a finding only when the repository shows the gap (backups
written to the same server, a script that never ran).

## PRD-07 Scaling and resource limits

State kept in memory that breaks with a second instance (sessions, rate-limit counters, caches,
scheduled jobs), uploads written to local disk, memory-heavy work in the request path, no limit
on the request body size. Pagination belongs to DAT-03.

## PRD-08 Mobile and client releases

When the repository is an app (Ionic, Capacitor, React Native): configuration per build
flavour, the app version and how old versions are made to update, crash reporting, store builds
signed in CI rather than on a laptop (often a question), web assets and API URLs that differ
between builds.
