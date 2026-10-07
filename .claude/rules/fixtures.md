# The own fixture and its answer key

- **A new aspect's planted defect may belong to an aspect that runs before it.** Agents run in
  catalogue order and skip what is already filed, so give the entry those items in `alsoItems`
  and write the hand-off in the checklist that gives the topic away ("while API design runs, …
  is API-02's"), not only in the one that takes it.
- **A new aspect reads the fixture's old code too.** Before the key is done, list what a correct
  agent of that aspect would report anywhere in the fixture, new pages and old, and key each one
  as a planted entry or a `known` issue, per file: the own fixture counts every other finding as
  false.
- **Fixture text names no defect** (`evals/fixtures.test.ts` greps for it); widen its word list
  with each aspect's vocabulary.
