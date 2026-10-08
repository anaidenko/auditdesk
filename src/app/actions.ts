"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
import {
    confirmDetectedStack,
    createRepository,
    deleteRepository,
    detectRepositoryStack,
    deleteProject as removeProject,
    saveRepositoryNotes,
    setRepositoryBranch
} from "@/server/projects";

/**
 * `askReserve`: the start was refused above the plan's reserve, so the form shows its checkbox whatever it rendered with.
 * `values`: what a refused form held, so it comes back as Andrii left it (React resets a form after its action).
 * `notice`: what an action did, said beside its button.
 */
export type FormState<V = never> = { error: string | null; askReserve?: boolean; values?: V; notice?: string };
export type RunValues = { aspects: string[]; budgetUsd: string; budgetKTokens: string; model: string; effort: string };
export type BriefValues = { product: string; concerns: string; outOfScope: string; aiBuilt: boolean };
export type NotesValues = { stackText: string; instructions: string };

const text = (fd: FormData, name: string) => String(fd.get(name) ?? "");

export async function createProject(_prev: FormState, fd: FormData): Promise<FormState> {
    const parsed = parseProjectForm(fd);
    if (!parsed.ok) return { error: parsed.error };
    const p = await prisma.project.create({ data: parsed.value });
    redirect(`/projects/${p.id}`);
}

export async function addRepository(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const parsed = parseRepositoryForm(fd);
    if (!parsed.ok) return { error: parsed.error };
    try {
        await createRepository(projectId, parsed.value.source, parsed.value.branch);
    } catch (e) {
        return { error: (e as Error).message };
    }
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
}

export async function removeRepository(projectId: string, repositoryId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
    try {
        await deleteRepository(repositoryId);
    } catch (e) {
        return { error: (e as Error).message };
    }
    // No notice: its toast would unmount with the row it came from; the row going is the answer.
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
}

export async function setBranch(projectId: string, repositoryId: string, _prev: FormState, fd: FormData): Promise<FormState> {
    const branch = String(fd.get("branch") ?? "").trim();
    try {
        await setRepositoryBranch(repositoryId, branch);
    } catch (e) {
        return { error: (e as Error).message };
    }
    revalidatePath(`/projects/${projectId}`);
    return { error: null, notice: `Branch saved: the next run clones ${branch}.` };
}

export async function saveBrief(projectId: string, _prev: FormState<BriefValues>, fd: FormData): Promise<FormState<BriefValues>> {
    const parsed = parseBriefForm(fd);
    if (!parsed.ok)
        return {
            error: parsed.error,
            values: {
                product: text(fd, "product"),
                concerns: text(fd, "concerns"),
                outOfScope: text(fd, "outOfScope"),
                aiBuilt: fd.get("aiBuilt") === "on"
            }
        };
    const { product, concerns, outOfScope, aiBuilt } = parsed.value;
    await prisma.project.update({
        where: { id: projectId },
        data: { briefProduct: product, briefConcerns: concerns, briefOutOfScope: outOfScope, aiBuilt, briefSavedAt: new Date() }
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

export async function saveNotes(
    projectId: string,
    repositoryId: string,
    _prev: FormState<NotesValues>,
    fd: FormData
): Promise<FormState<NotesValues>> {
    const parsed = parseRepositoryNotesForm(fd);
    if (!parsed.ok) return { error: parsed.error, values: { stackText: text(fd, "stackText"), instructions: text(fd, "instructions") } };
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

export async function startRun(projectId: string, _prev: FormState<RunValues>, fd: FormData): Promise<FormState<RunValues>> {
    const refused = await tryStartRun(projectId, fd);
    return {
        ...refused,
        values: {
            aspects: fd.getAll("aspects").map(String),
            budgetUsd: text(fd, "budgetUsd"),
            budgetKTokens: text(fd, "budgetKTokens"),
            model: text(fd, "model"),
            effort: text(fd, "effort")
        }
    };
}

export async function adoptDetection(projectId: string, repositoryId: string): Promise<void> {
    await prisma.repository.findFirstOrThrow({ where: { id: repositoryId, projectId } });
    await confirmDetectedStack(repositoryId);
    revalidatePath(`/projects/${projectId}`);
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
