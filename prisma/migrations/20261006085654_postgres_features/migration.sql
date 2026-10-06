-- CreateIndex
CREATE INDEX "Finding_unreviewed_idx" ON "Finding"("projectId", "severity") WHERE (status = 'unreviewed');

-- CreateIndex
CREATE INDEX "Job_queued_idx" ON "Job"("createdAt") WHERE (status = 'queued');

-- CreateIndex
CREATE UNIQUE INDEX "Run_one_active_per_project" ON "Run"("projectId") WHERE (status IN ('queued', 'running'));

-- Full-text search over findings, kept current by a trigger.
CREATE FUNCTION finding_search_update() RETURNS trigger AS $$
BEGIN
    NEW.search :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.summary, '') || ' ' || coalesce(NEW.explanation, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(NEW.evidence::text, '')), 'C');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER finding_search BEFORE INSERT OR UPDATE OF title, summary, explanation, evidence ON "Finding"
    FOR EACH ROW EXECUTE FUNCTION finding_search_update();
