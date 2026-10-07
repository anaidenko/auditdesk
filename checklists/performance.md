# Performance

From the code alone: nothing is run, so no time is measured and no query plan is read. Report
work the code does that grows with traffic, data or the page, and say what a measurement would
confirm. What only production can show (real latency, Core Web Vitals, the slowest queries)
becomes a question. Timeouts on outbound calls are PRD-04, state that breaks with a second
instance is PRD-07, and code that works around the framework is ARC-08; file here what such code
costs in time or bytes when no other aspect names it. Query shape and indexes belong to Data
(DAT-02, DAT-03) when it is in this run, and to PRF-07 when it is not.

Severity: high when ordinary traffic is slow or failing because of it now (a page that waits on
several outbound calls in a row, an endpoint whose work grows with the whole table). Medium for
costs that grow with the data or the audience (repeated uncached work, a large client bundle,
images served at full size). Low for small savings.

## PRF-01 Caching

Work repeated on every request that could be cached: identical outbound calls (currency rates,
a partner's price list, configuration); framework caches switched off (`cache: "no-store"`,
`force-dynamic`, `revalidate = 0`) for data that rarely changes; public and static responses
without cache headers; caches with no expiry, or with a key that misses an input (a missing
tenant is TEN-05).

## PRF-02 Work on the request path

Independent awaits run one after another (outbound calls, queries) where they could run
together; synchronous file, crypto or compression calls in a handler; CPU-heavy loops over data
that grows; the same data loaded twice in one request.

## PRF-03 Client bundle

Whole libraries imported for one function (`lodash`, `moment`, icon sets); heavy components
loaded on every page rather than on demand; client components (`"use client"`) high in the tree
that pull server-renderable code into the bundle; large data files imported into client code.

## PRF-04 Rendering

Expensive work inside render on every update (sorting, filtering or formatting large lists);
state kept so high that one change re-renders a page; long lists without virtualisation or
pagination; effects that fetch on every render; content with no reserved space that shifts the
layout. Angular: `ngFor` without `trackBy`, default change detection on heavy trees.

## PRF-05 Images, fonts and media

Images served at full size where a smaller one would do, without dimensions, `srcset` or lazy
loading below the fold, while the framework's image component goes unused (`next/image`,
`NgOptimizedImage`); fonts without `font-display` or loaded from a third party on every page;
video that loads before it is played.

## PRF-06 Memory

Listeners, intervals and subscriptions that are never removed, for the memory they hold (the
missing cleanup itself is ARC-05's); caches and maps that grow without a bound; whole files or
result sets read into memory where a stream or a page would do.

## PRF-07 Database load

When the Data aspect is not in this run: queries inside loops (N+1), frequent filters and foreign
keys without an index, whole tables loaded to count or filter in code. When it is, leave these to
DAT-02 and DAT-03.
