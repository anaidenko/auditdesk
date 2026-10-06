"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { DEFAULT_EFFORT, DEFAULT_MODEL } from "@/engine/agent/request";
import { workspaceDir } from "@/engine/config";
import { credentialStatus } from "@/engine/credentials";
import { readPlanUsage, reserveRefusal } from "@/engine/plan-usage";
import { prisma } from "@/server/db";
import {
    parseBriefForm,
    parseModelAccess,
    parseProjectForm,
    parseRepositoryForm,
    parseRepositoryNotesForm,
    parseRunForm
} from "@/server/forms";
import { ActiveRunError, enqueueRun, requestStop } from "@/server/jobs";
import { detectRepositoryStack, deleteProject as removeProject, saveRepositoryNotes } from "@/server/projects";

/**
 * `askReserve`: the start was refused above the plan's reserve, so the form shows its checkbox whatever it rendered with.
 * `values`: what a refused run form held, so it comes back as Andrii left it (React resets a form after its action).
 */
export type FormState = {
    error: string | null;
    askReserve?: boolean;
    values?: { aspects: string[]; budgetUsd: string; budgetKTokens: string };
};

export async function createProject(_prev: FormState, fd: FormData): Promise<FormState> {
    const parsed = parseProjectForm(fd);
    if (!parsed.ok) return { error: parsed.error };
    const p = await prisma.project.create({ data: parsed.value });
    redirect(`/projects/${p.id}`);
}

export async function addRepository(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const parsed = parseRepositoryForm(fd);
    if (!parsed.ok) return { error: parsed.error };
    await prisma.repository.create({ data: { projectId, ...parsed.value } });
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
}

export async function saveBrief(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const parsed = parseBriefForm(fd);
    if (!parsed.ok) return { error: parsed.error };
    const { product, concerns, outOfScope, aiBuilt } = parsed.value;
    await prisma.project.update({
        where: { id: projectId },
        data: { briefProduct: product, briefConcerns: concerns, briefOutOfScope: outOfScope, aiBuilt }
    });
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
}

export async function detectStack(projectId: string, repositoryId: string, _prev: FormState): Promise<FormState> {
    try {
        await detectRepositoryStack(projectId, repositoryId, workspaceDir());
    } catch (e) {
        if (e instanceof ActiveRunError) return { error: "A run of this project is queued or running; detect the stack when it ends." };
        return { error: `Could not detect the stack: ${(e as Error).message}` };
    }
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
}

export async function saveNotes(projectId: string, repositoryId: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const parsed = parseRepositoryNotesForm(fd);
    if (!parsed.ok) return { error: parsed.error };
    await prisma.repository.findFirstOrThrow({ where: { id: repositoryId, projectId } });
    await saveRepositoryNotes(repositoryId, parsed.value);
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
}

export async function setConsent(projectId: string, fd: FormData): Promise<void> {
    await prisma.project.update({ where: { id: projectId }, data: { aiConsentAt: fd.get("consent") === "on" ? new Date() : null } });
    revalidatePath(`/projects/${projectId}`);
}

export async function setModelAccess(projectId: string, fd: FormData): Promise<void> {
    const parsed = parseModelAccess(fd);
    if (!parsed.ok) return;
    await prisma.project.update({ where: { id: projectId }, data: { modelAccess: parsed.value } });
    revalidatePath(`/projects/${projectId}`);
}

export async function startRun(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const refused = await tryStartRun(projectId, fd);
    return {
        ...refused,
        values: {
            aspects: fd.getAll("aspects").map(String),
            budgetUsd: String(fd.get("budgetUsd") ?? ""),
            budgetKTokens: String(fd.get("budgetKTokens") ?? "")
        }
    };
}

/** Redirects to the new run, or says why it did not start. */
async function tryStartRun(projectId: string, fd: FormData): Promise<FormState> {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { repositories: true } });
    if (!project.aiConsentAt) return { error: "Record the client's AI consent first." };
    const credential = await credentialStatus(project.modelAccess);
    if (credential.source === "error") return { error: credential.message };
    if (credential.source === "none")
        return {
            error:
                project.modelAccess === "claude_plan"
                    ? "No Claude plan token: add it in Settings or .env.local."
                    : "No API key: add it in Settings or .env.local."
        };
    const allowPastReserve = fd.get("allowPastReserve") === "on";
    const refusal = project.modelAccess === "claude_plan" ? reserveRefusal(await readPlanUsage(), allowPastReserve) : null;
    if (refusal) return { error: `${refusal} Tick "Allow past the 50% reserve" to start anyway.`, askReserve: true };
    if (!project.repositories.length) return { error: "Add a repository first." };
    const parsed = parseRunForm(fd, project.repositories.length);
    if (!parsed.ok) return { error: parsed.error };
    let runId: string;
    try {
        runId = await enqueueRun(projectId, {
            model: DEFAULT_MODEL,
            effort: DEFAULT_EFFORT,
            modelAccess: project.modelAccess,
            allowPastReserve,
            ...parsed.value
        });
    } catch (e) {
        if (e instanceof ActiveRunError) return { error: e.message };
        throw e;
    }
    redirect(`/runs/${runId}`);
}

export async function stopRun(runId: string): Promise<void> {
    await requestStop(runId);
}

export async function deleteProject(projectId: string): Promise<void> {
    await removeProject(projectId, workspaceDir());
    redirect("/");
}
