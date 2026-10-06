"use client";

import { useActionState } from "react";

import { type FormState, createProject } from "./actions";

export function NewProjectForm() {
    const [state, action, pending] = useActionState<FormState, FormData>(createProject, { error: null });
    return (
        <form action={action} className="flex items-start gap-3">
            <div>
                <input
                    name="name"
                    placeholder="Client or project name"
                    className="w-72 rounded border border-zinc-300 px-3 py-2"
                    aria-label="Project name"
                />
                {state.error && <p className="mt-1 text-sm text-red-700">{state.error}</p>}
            </div>
            <button disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50">
                New project
            </button>
        </form>
    );
}
