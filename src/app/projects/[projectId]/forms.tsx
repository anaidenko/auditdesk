"use client";

import { useActionState, useLayoutEffect, useRef, useState } from "react";

import {
    type BriefValues,
    type FormState,
    type NotesValues,
    type RunValues,
    addRepository,
    adoptDetection,
    detectStack,
    saveBrief,
    saveNotes,
    startRun
} from "@/app/actions";
import { ACCESS_LABEL } from "@/app/model-access";
import { Badge, FormError, Icon, button, input, label, select } from "@/app/ui";
import { DEFAULT_EFFORT, DEFAULT_MODEL, type Effort } from "@/engine/agent/request";
import { ASPECTS, agentCount } from "@/engine/aspects";
import { type CostStats, type PlanShareRate, estimateRun, forecastPlanShare, pickStats } from "@/engine/estimate";
import { EFFORTS, MODEL_CHOICES } from "@/engine/models";
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
            <input name="branch" placeholder="default branch" className={`${input} min-w-28 flex-1`} aria-label="Branch" />
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
    planUsage,
    repositories,
    costStats
}: {
    projectId: string;
    access: ModelAccess;
    defaults: { usd: number; tokens: number };
    repositories: number;
    /** Each offered model's per-agent cost from past runs, for the estimate. */
    costStats: Record<string, CostStats>;
    /** The aspects the project's last run audited; the form starts from them. */
    chosen: string[];
    /** Conditional aspects the repositories' stacks call for, ticked too. */
    suggested: string[];
    /**
     * Claude plan only: the last 5-hour reading's line and whether it is past the reserve, the
     * reading itself while its window lasts, the reserve, and the window's share per dollar measured.
     */
    planUsage: {
        line: string;
        overReserve: boolean;
        reading: { utilization: number; seen: string } | null;
        reserve: number;
        rate: PlanShareRate | null;
    } | null;
}) {
    const [state, action, pending] = useActionState<FormState<RunValues>, FormData>(startRun.bind(null, projectId), { error: null });
    const ticked = (key: string) => key === "security" || (state.values?.aspects ?? [...chosen, ...suggested]).includes(key);
    const [live, setLive] = useState({
        aspects: ASPECTS.filter(a => ticked(a.key)).map(a => a.key as string),
        usd: defaults.usd,
        model: DEFAULT_MODEL as string,
        effort: DEFAULT_EFFORT as Effort
    });
    const form = useRef<HTMLFormElement>(null);
    // Security is disabled, so the form data never holds it.
    const read = (f: HTMLFormElement | null) => {
        if (!f) return;
        const fd = new FormData(f);
        setLive({
            aspects: ["security", ...fd.getAll("aspects").map(String)],
            usd: Number(fd.get("budgetUsd")),
            model: String(fd.get("model")),
            effort: String(fd.get("effort")) as Effort
        });
    };
    // React sets a box's `checked` when it mounts, after which a new `defaultChecked` no longer moves
    // it: a suggestion that arrives or goes later (a detection on this page) moves its box here, as a
    // reload would, leaving the rest of the form as Andrii left it.
    const offered = useRef(suggested);
    // A box moved that way, or values a browser restored, change the form without a change event.
    useLayoutEffect(() => {
        const f = form.current;
        const tick = (key: string, on: boolean) => {
            const box = f?.querySelector<HTMLInputElement>(`input[name="aspects"][value="${key}"]`);
            if (box) box.checked = on;
        };
        for (const key of suggested.filter(k => !offered.current.includes(k))) tick(key, true);
        for (const key of offered.current.filter(k => !suggested.includes(k) && !chosen.includes(k))) tick(key, false);
        offered.current = suggested;
        read(f);
    }, [chosen, suggested, repositories, state]);
    const picked = pickStats(costStats, live.model, live.effort);
    const estimate = repositories ? estimateRun(picked.stats, agentCount(repositories, live.aspects), live.usd, picked.basis) : null;
    const share =
        planUsage && estimate ? forecastPlanShare(estimate, planUsage.rate, planUsage.reading, planUsage.reserve, live.usd) : null;
    return (
        // Remounted with what a refused start held, since React resets a form after its action.
        <form
            ref={form}
            key={JSON.stringify(state.values ?? null)}
            action={action}
            onChange={e => read(e.currentTarget)}
            className="space-y-4"
        >
            <fieldset>
                <legend className={label}>Aspects</legend>
                <div className="mt-1.5 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                    {ASPECTS.map(a => (
                        <label key={a.key} className="flex items-start gap-2 text-sm text-zinc-700">
                            <input
                                type="checkbox"
                                name="aspects"
                                value={a.key}
                                defaultChecked={ticked(a.key)}
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
                    Model
                    <select name="model" defaultValue={state.values?.model || DEFAULT_MODEL} className={`${select} mt-1.5 w-full`}>
                        {MODEL_CHOICES.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className={label}>
                    Effort
                    <select name="effort" defaultValue={state.values?.effort || DEFAULT_EFFORT} className={`${select} mt-1.5 w-full`}>
                        {EFFORTS.map(e => (
                            <option key={e}>{e}</option>
                        ))}
                    </select>
                </label>
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
            {estimate && (
                <div className="space-y-1 text-xs">
                    <p data-testid="estimate" className="text-zinc-600">
                        {estimate.text}
                        {access === "claude_plan" ? " API-equivalent; the plan bills nothing." : ""}
                    </p>
                    {estimate.warning && <p className="font-medium text-amber-800">{estimate.warning}</p>}
                </div>
            )}
            {planUsage && (
                <div className="space-y-2 text-xs text-zinc-600">
                    <p data-testid="plan-usage">{planUsage.line}</p>
                    {share && <p data-testid="plan-share">{share.text}</p>}
                    {share?.warning && <p className="font-medium text-amber-800">{share.warning}</p>}
                    {(planUsage.overReserve || state.askReserve || share?.mayCross) && (
                        <label className="flex items-center gap-2 font-medium text-amber-800">
                            <input type="checkbox" name="allowPastReserve" className="size-4 rounded border-zinc-300 accent-amber-600" />
                            Allow past the {Math.round(planUsage.reserve * 100)}% reserve
                        </label>
                    )}
                </div>
            )}
            <button disabled={pending} className={`${button.primary} w-full`}>
                <Icon name="play" />
                Start run
            </button>
            <p className="text-xs text-zinc-500">
                Security is always on · {ACCESS_LABEL[access]} · Sonnet 5.5 at low effort is the cheapest; another model or effort costs
                more. The cap is split equally between the aspects and repositories, and checked between calls
                {access === "claude_plan" ? ", in API-equivalent dollars" : ""}.
            </p>
            {state.error && <FormError>{state.error}</FormError>}
        </form>
    );
}

const textarea = `${input} mt-1.5 min-h-20 font-sans`;
// The server refuses more (src/server/forms.ts); the browser stops typing there first.
const MAX_NOTE = 4000;

export function BriefForm({
    projectId,
    brief,
    aiBuiltSigns
}: {
    projectId: string;
    brief: { product: string | null; concerns: string | null; outOfScope: string | null; aiBuilt: boolean };
    /** Signs of AI-built code that stack detection found since the brief was last saved. */
    aiBuiltSigns: string[];
}) {
    const [state, action, pending] = useActionState<FormState<BriefValues>, FormData>(saveBrief.bind(null, projectId), { error: null });
    const v = state.values;
    return (
        // Remounted with what a refused save held, since React resets a form after its action.
        <form key={JSON.stringify(v ?? null)} action={action} className="space-y-3">
            <label className={label}>
                What the product does
                <textarea name="product" maxLength={MAX_NOTE} defaultValue={v?.product ?? brief.product ?? ""} className={textarea} />
            </label>
            <label className={label}>
                Known concerns
                <textarea name="concerns" maxLength={MAX_NOTE} defaultValue={v?.concerns ?? brief.concerns ?? ""} className={textarea} />
            </label>
            <label className={label}>
                Out of scope
                <textarea
                    name="outOfScope"
                    maxLength={MAX_NOTE}
                    defaultValue={v?.outOfScope ?? brief.outOfScope ?? ""}
                    className={textarea}
                />
            </label>
            <label className="flex items-start gap-2.5 text-sm text-zinc-700">
                <input
                    type="checkbox"
                    name="aiBuilt"
                    defaultChecked={v?.aiBuilt ?? brief.aiBuilt}
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
    detectedAt,
    stackText,
    confirmedAt,
    instructions
}: {
    projectId: string;
    repositoryId: string;
    /** The last detection, as text. */
    detected: string | null;
    detectedAt: string | null;
    stackText: string | null;
    confirmedAt: string | null;
    instructions: string | null;
}) {
    const [detectState, detect, detecting] = useActionState<FormState, FormData>(detectStack.bind(null, projectId, repositoryId), {
        error: null
    });
    const [state, save, saving] = useActionState<FormState<NotesValues>, FormData>(saveNotes.bind(null, projectId, repositoryId), {
        error: null
    });
    const changed = !!confirmedAt && !!detected && detected !== stackText;
    const v = state.values;
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
                {changed && <Badge tone="amber">detection changed</Badge>}
            </summary>
            <div className="mt-3 space-y-3">
                <form action={detect} className="flex flex-wrap items-center gap-3">
                    <button disabled={detecting} className={`${button.secondary} ${button.small}`}>
                        {detecting ? "Detecting…" : "Detect stack"}
                    </button>
                    <span className="text-xs text-zinc-500">
                        A shallow clone of the branch; its manifests are read, nothing is installed or run.
                    </span>
                    {detectState.error && <FormError>{detectState.error}</FormError>}
                </form>
                {changed && (
                    <div className="space-y-2 rounded-lg bg-amber-50 px-3.5 py-3 ring-1 ring-amber-600/15 ring-inset">
                        <p className="text-xs text-amber-900">
                            The detection of {detectedAt} differs from the confirmed profile. Agents read the confirmed one until you change
                            it.
                        </p>
                        <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-zinc-800">{detected}</pre>
                        <form action={adoptDetection.bind(null, projectId, repositoryId)}>
                            <button className={`${button.secondary} ${button.small}`}>Use this detection</button>
                        </form>
                    </div>
                )}
                <form action={save} className="space-y-3">
                    <label className={label}>
                        Stack profile
                        {/* Remounted on a new detection or a refused save; the instructions keep what was typed. */}
                        <textarea
                            key={`${detected}|${v?.stackText ?? ""}`}
                            name="stackText"
                            maxLength={MAX_NOTE}
                            defaultValue={v?.stackText ?? stackText ?? detected ?? ""}
                            className={`${textarea} min-h-40 font-mono text-xs`}
                        />
                    </label>
                    <label className={label}>
                        How to run it, its local URL, its database
                        <span className="mt-0.5 block font-normal tracking-normal normal-case">
                            Every agent reads it: a URL&apos;s password is masked, but leave other secrets out.
                        </span>
                        <textarea
                            key={v?.instructions ?? ""}
                            name="instructions"
                            maxLength={MAX_NOTE}
                            defaultValue={v?.instructions ?? instructions ?? ""}
                            className={textarea}
                        />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                        <button name="intent" value="confirm" disabled={saving} className={`${button.secondary} ${button.small}`}>
                            Save and confirm the profile
                        </button>
                        <button name="intent" value="instructions" disabled={saving} className={`${button.secondary} ${button.small}`}>
                            Save the instructions only
                        </button>
                        <span className="text-xs text-zinc-500">Agents read a confirmed profile as written; empty it to detect again.</span>
                    </div>
                    {state.error && <FormError>{state.error}</FormError>}
                </form>
            </div>
        </details>
    );
}
