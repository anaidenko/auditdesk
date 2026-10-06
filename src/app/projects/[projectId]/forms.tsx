"use client";

import { useActionState } from "react";

import { type FormState, addRepository, detectStack, saveBrief, saveNotes, startRun } from "@/app/actions";
import { ACCESS_LABEL } from "@/app/model-access";
import { Badge, FormError, Icon, button, input, label } from "@/app/ui";
import { DEFAULT_EFFORT, DEFAULT_MODEL } from "@/engine/agent/request";
import { ASPECTS } from "@/engine/aspects";
import type { ModelAccess } from "@/engine/types";

export function AddRepositoryForm({ projectId }: { projectId: string }) {
    const [state, action, pending] = useActionState<FormState, FormData>(addRepository.bind(null, projectId), { error: null });
    return (
        <form action={action} className="flex flex-wrap items-start gap-3">
            <input
                name="source"
                placeholder="git@github.com:acme/app.git or /Users/…/app"
                className={`${input} min-w-64 flex-[3]`}
                aria-label="Repository URL or path"
            />
            <input name="branch" placeholder="main" className={`${input} w-32 flex-1`} aria-label="Branch" />
            <button disabled={pending} className={button.secondary}>
                Add repository
            </button>
            {state.error && <FormError>{state.error}</FormError>}
        </form>
    );
}

export function StartRunForm({
    projectId,
    access,
    defaults,
    chosen,
    suggested,
    planUsage
}: {
    projectId: string;
    access: ModelAccess;
    defaults: { usd: number; tokens: number };
    /** The aspects the project's last run audited; the form starts from them. */
    chosen: string[];
    /** Conditional aspects the repositories' stacks call for, ticked too. */
    suggested: string[];
    /** Claude plan only: the last 5-hour reading, and whether it is past the reserve. */
    planUsage: { line: string; overReserve: boolean } | null;
}) {
    const [state, action, pending] = useActionState<FormState, FormData>(startRun.bind(null, projectId), { error: null });
    return (
        // Remounted with what a refused start held, since React resets a form after its action.
        <form key={JSON.stringify(state.values ?? null)} action={action} className="space-y-4">
            <fieldset>
                <legend className={label}>Aspects</legend>
                <div className="mt-1.5 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                    {ASPECTS.map(a => (
                        <label key={a.key} className="flex items-start gap-2 text-sm text-zinc-700">
                            <input
                                type="checkbox"
                                name="aspects"
                                value={a.key}
                                defaultChecked={a.key === "security" || (state.values?.aspects ?? [...chosen, ...suggested]).includes(a.key)}
                                disabled={a.key === "security"}
                                className="mt-0.5 size-4 rounded border-zinc-300 accent-indigo-600"
                            />
                            <span>
                                {a.title}
                                {"when" in a && (
                                    <span className="block text-xs text-zinc-500">
                                        {suggested.includes(a.key) ? "suggested: " : "when "}
                                        {a.when}
                                    </span>
                                )}
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
                <label className={label}>
                    Cap, USD
                    <input
                        name="budgetUsd"
                        type="number"
                        step="0.5"
                        min="0.5"
                        defaultValue={state.values?.budgetUsd ?? defaults.usd}
                        className={`${input} mt-1.5`}
                    />
                </label>
                <label className={label}>
                    Cap, thousand tokens
                    <input
                        name="budgetKTokens"
                        type="number"
                        step="10"
                        min="20"
                        defaultValue={state.values?.budgetKTokens ?? defaults.tokens / 1000}
                        className={`${input} mt-1.5`}
                    />
                </label>
            </div>
            {planUsage && (
                <div className="space-y-2 text-xs text-zinc-600">
                    <p data-testid="plan-usage">{planUsage.line}</p>
                    {(planUsage.overReserve || state.askReserve) && (
                        <label className="flex items-center gap-2 font-medium text-amber-800">
                            <input type="checkbox" name="allowPastReserve" className="size-4 rounded border-zinc-300 accent-amber-600" />
                            Allow past the 50% reserve
                        </label>
                    )}
                </div>
            )}
            <button disabled={pending} className={`${button.primary} w-full`}>
                <Icon name="play" />
                Start run
            </button>
            <p className="text-xs text-zinc-500">
                Security is always on · {ACCESS_LABEL[access]} · {DEFAULT_MODEL} · effort {DEFAULT_EFFORT}. The cap is split equally between
                the aspects and repositories, and checked between calls{access === "claude_plan" ? ", in API-equivalent dollars" : ""}.
            </p>
            {state.error && <FormError>{state.error}</FormError>}
        </form>
    );
}

const textarea = `${input} mt-1.5 min-h-20 font-sans`;

export function BriefForm({
    projectId,
    brief,
    aiBuiltSigns
}: {
    projectId: string;
    brief: { product: string | null; concerns: string | null; outOfScope: string | null; aiBuilt: boolean };
    /** Files and packages stack detection took for signs of AI-built code. */
    aiBuiltSigns: string[];
}) {
    const [state, action, pending] = useActionState<FormState, FormData>(saveBrief.bind(null, projectId), { error: null });
    return (
        <form action={action} className="space-y-3">
            <label className={label}>
                What the product does
                <textarea name="product" defaultValue={brief.product ?? ""} className={textarea} />
            </label>
            <label className={label}>
                Known concerns
                <textarea name="concerns" defaultValue={brief.concerns ?? ""} className={textarea} />
            </label>
            <label className={label}>
                Out of scope
                <textarea name="outOfScope" defaultValue={brief.outOfScope ?? ""} className={textarea} />
            </label>
            <label className="flex items-start gap-2.5 text-sm text-zinc-700">
                <input
                    type="checkbox"
                    name="aiBuilt"
                    defaultChecked={brief.aiBuilt}
                    className="mt-0.5 size-4 rounded border-zinc-300 accent-indigo-600"
                />
                <span>
                    The code is largely AI-built: switch on the checklists&apos; AI-built items
                    {!brief.aiBuilt && aiBuiltSigns.length > 0 && (
                        <span className="block text-xs text-amber-700">Suggested by stack detection: {aiBuiltSigns.join(", ")}</span>
                    )}
                </span>
            </label>
            <div className="flex items-center gap-3">
                <button disabled={pending} className={`${button.secondary} ${button.small}`}>
                    Save brief
                </button>
                <span className="text-xs text-zinc-500">Every agent reads it, with secrets masked.</span>
            </div>
            {state.error && <FormError>{state.error}</FormError>}
        </form>
    );
}

export function RepositoryNotes({
    projectId,
    repositoryId,
    detected,
    stackText,
    confirmedAt,
    instructions
}: {
    projectId: string;
    repositoryId: string;
    /** The last detection, as text. */
    detected: string | null;
    stackText: string | null;
    confirmedAt: string | null;
    instructions: string | null;
}) {
    const [detectState, detect, detecting] = useActionState<FormState, FormData>(detectStack.bind(null, projectId, repositoryId), {
        error: null
    });
    const [state, save, saving] = useActionState<FormState, FormData>(saveNotes.bind(null, projectId, repositoryId), { error: null });
    return (
        <details className="group w-full">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-indigo-700 [&::-webkit-details-marker]:hidden">
                Stack and instructions
                {confirmedAt ? (
                    <Badge tone="emerald">confirmed {confirmedAt}</Badge>
                ) : detected ? (
                    <Badge tone="amber">detected, not confirmed</Badge>
                ) : (
                    <Badge tone="slate">not detected yet</Badge>
                )}
            </summary>
            <div className="mt-3 space-y-3">
                <form action={detect} className="flex flex-wrap items-center gap-3">
                    <button disabled={detecting} className={`${button.secondary} ${button.small}`}>
                        Detect stack
                    </button>
                    <span className="text-xs text-zinc-500">Clones the branch and reads its manifests; nothing is installed or run.</span>
                    {detectState.error && <FormError>{detectState.error}</FormError>}
                </form>
                {/* Remounted on a new detection, so the field shows it rather than what the browser kept. */}
                <form key={detected ?? ""} action={save} className="space-y-3">
                    <label className={label}>
                        Stack profile
                        <textarea
                            name="stackText"
                            defaultValue={stackText ?? detected ?? ""}
                            className={`${textarea} min-h-40 font-mono text-xs`}
                        />
                    </label>
                    <label className={label}>
                        How to run it, its local URL, its database
                        <textarea name="instructions" defaultValue={instructions ?? ""} className={textarea} />
                    </label>
                    <div className="flex items-center gap-3">
                        <button disabled={saving} className={`${button.secondary} ${button.small}`}>
                            Save and confirm
                        </button>
                        <span className="text-xs text-zinc-500">
                            Agents read the profile as written; empty it to detect again at the next run.
                        </span>
                    </div>
                    {state.error && <FormError>{state.error}</FormError>}
                </form>
            </div>
        </details>
    );
}
