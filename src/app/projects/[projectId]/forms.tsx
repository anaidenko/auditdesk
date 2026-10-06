"use client";

import { useActionState } from "react";

import { type FormState, addRepository, startRun } from "@/app/actions";
import { ACCESS_LABEL } from "@/app/model-access";
import { FormError, Icon, button, input, label } from "@/app/ui";
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
    planUsage
}: {
    projectId: string;
    access: ModelAccess;
    defaults: { usd: number; tokens: number };
    /** The aspects the project's last run audited; the form starts from them. */
    chosen: string[];
    /** Claude plan only: the last 5-hour reading, and whether it is past the reserve. */
    planUsage: { line: string; overReserve: boolean } | null;
}) {
    const [state, action, pending] = useActionState<FormState, FormData>(startRun.bind(null, projectId), { error: null });
    return (
        <form action={action} className="space-y-4">
            <fieldset>
                <legend className={label}>Aspects</legend>
                <div className="mt-1.5 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                    {ASPECTS.map(a => (
                        <label key={a.key} className="flex items-start gap-2 text-sm text-zinc-700">
                            <input
                                type="checkbox"
                                name="aspects"
                                value={a.key}
                                defaultChecked={a.key === "security" || chosen.includes(a.key)}
                                disabled={a.key === "security"}
                                className="mt-0.5 size-4 rounded border-zinc-300 accent-indigo-600"
                            />
                            <span>
                                {a.title}
                                {"when" in a && <span className="block text-xs text-zinc-500">when {a.when}</span>}
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
                <label className={label}>
                    Cap, USD
                    <input name="budgetUsd" type="number" step="0.5" min="0.5" defaultValue={defaults.usd} className={`${input} mt-1.5`} />
                </label>
                <label className={label}>
                    Cap, thousand tokens
                    <input
                        name="budgetKTokens"
                        type="number"
                        step="10"
                        min="20"
                        defaultValue={defaults.tokens / 1000}
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
