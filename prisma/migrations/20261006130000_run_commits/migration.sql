-- A re-run audits the commit its own run audited, not the repository's latest clone.
ALTER TABLE "Run" ADD COLUMN "commits" JSONB;
