"use client";

import { useActionState } from "react";

import { type FormState, addRepository, startRun } from "@/app/actions";

export function AddRepositoryForm({ projectId }: { projectId: string }) {
    const [state, action, pending] = useActionState<FormState, FormData>(addRepository.bind(null, projectId), { error: null });
    return (
        <form action={action} className="flex flex-wrap items-start gap-3">
            <input
                name="source"
                placeholder="git@github.com:acme/app.git or /Users/…/app"
                className="w-96 rounded border border-zinc-300 px-3 py-2"
                aria-label="Repository URL or path"
            />
            <input name="branch" placeholder="main" className="w-40 rounded border border-zinc-300 px-3 py-2" aria-label="Branch" />
            <button disabled={pending} className="rounded border border-zinc-900 px-4 py-2 disabled:opacity-50">
                Add repository
            </button>
            {state.error && <p className="w-full text-sm text-red-700">{state.error}</p>}
        </form>
    );
}

export function StartRunForm({ projectId, defaults }: { projectId: string; defaults: { usd: number; tokens: number } }) {
    const [state, action, pending] = useActionState<FormState, FormData>(startRun.bind(null, projectId), { error: null });
    return (
        <form action={action} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
                Cap, USD
                <input
                    name="budgetUsd"
                    type="number"
                    step="0.5"
                    min="0.5"
                    defaultValue={defaults.usd}
                    className="mt-1 block w-28 rounded border border-zinc-300 px-3 py-2"
                />
            </label>
            <label className="text-sm">
                Cap, tokens
                <input
                    name="budgetTokens"
                    type="number"
                    step="10000"
                    min="20000"
                    defaultValue={defaults.tokens}
                    className="mt-1 block w-36 rounded border border-zinc-300 px-3 py-2"
                />
            </label>
            <button disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50">
                Start run
            </button>
            <p className="w-full text-sm text-zinc-500">
                Security aspect · Claude Opus 5.5 · effort medium. The cap is checked between calls.
            </p>
            {state.error && <p className="w-full text-sm text-red-700">{state.error}</p>}
        </form>
    );
}
