import type { NewFinding } from "@/engine/types";
import { prisma } from "@/server/db";

export async function projectWithRepo(source = "/tmp/x") {
    const project = await prisma.project.create({ data: { name: "Acme", aiConsentAt: new Date() } });
    const repo = await prisma.repository.create({ data: { projectId: project.id, source, branch: "main" } });
    return { project, repo };
}

export function sampleFinding(repositoryId: string, over: Partial<NewFinding> = {}): NewFinding {
    return {
        repositoryId,
        agentRunId: null,
        aspect: "security",
        kind: "finding",
        checklistItem: "SEC-01",
        title: "t",
        severity: "high",
        likelihood: null,
        impact: null,
        summary: "s",
        explanation: "e",
        recommendation: "r",
        effort: "S",
        evidence: [{ file: "a.ts", startLine: 1, endLine: 1 }],
        references: {},
        tags: [],
        source: "agent",
        fingerprint: Math.random().toString(36),
        ...over
    };
}
