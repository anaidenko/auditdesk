# Architecture and structure

How the code is organised, and whether the structure makes a change safe or risky. Cite the
files that show each issue. Do not report a preference for another architecture: report what
makes a change break something elsewhere, a class of bug the structure invites, or work the
structure makes slow, with the file that shows it.

Severity: critical or high only when the structure causes harm now: errors swallowed so that
failures go unseen and data is lost, configuration that can point production at the wrong
resources. Most findings here are medium (a change in one place breaks another; the structure
invites a class of bug) or low (it slows the team down).

## ARC-01 Layering and boundaries

UI components that call the database or third-party APIs directly; business rules in route
handlers, controllers or components instead of a service layer; server-only code importable
into the client bundle (Next.js `server-only`, misplaced `"use client"`); Angular components
holding logic that belongs in services.

## ARC-02 Modules and coupling

Circular imports, files of thousands of lines, a `utils` folder that everything depends on,
features reaching into each other's internals, shared mutable singletons, the same concept
modelled differently in two places.

## ARC-03 Error handling

Errors swallowed (`catch {}`, `.catch(() => {})`, a promise neither awaited nor caught), errors
turned into success responses, inconsistent error shapes from one API, no error boundary in
React or global `ErrorHandler` in Angular, no handler for unhandled rejections in Node.js.

## ARC-04 Configuration

Environment variables read all over the code instead of one module that validates them at
start-up; behaviour that branches on `NODE_ENV` or the host name; Angular `environment.ts`
files that drift apart; defaults that point at production.

## ARC-05 State and data flow

Server data copied into global client stores and invalidated by hand; state duplicated between
components; subscriptions and effects that are never cleaned up (RxJS without `takeUntil` or
`async` pipe, `useEffect` without a cleanup); derived data stored instead of computed.

## ARC-06 Long work and side effects

Slow work inside a request (emails, PDFs, imports, AI calls) with no queue and no timeout;
fire-and-forget promises; retries of non-idempotent work; scheduled jobs inside the web process
that run once per instance.

## ARC-07 Contracts between parts

Types for one API written by hand on both sides, where they drift, rather than shared or
generated (OpenAPI, tRPC, GraphQL codegen); front end and back end that disagree on a field's
shape or optionality; events and messages without a schema.

## ARC-08 Use of the framework

Code that works around the framework: Next.js pages that fetch on the client what a Server
Component could render, Pages Router patterns inside the App Router, Angular change detection
forced with `setTimeout` or `detectChanges` throughout, Ionic page lifecycle misused, APIs the
framework version in use deprecates.
