"use client";

import { useActionState } from "react";

import { type FormState, createProject } from "./actions";
import { FormError, Icon, button, input } from "./ui";

export function NewProjectForm() {
    const [state, action, pending] = useActionState<FormState, FormData>(createProject, { error: null });
    return (
        <form action={action} className="flex flex-wrap items-start gap-3">
            <input name="name" placeholder="Client or project name" className={`${input} max-w-sm flex-1`} aria-label="Project name" />
            <button disabled={pending} className={button.primary}>
                <Icon name="folder" />
                New project
            </button>
            {state.error && <FormError>{state.error}</FormError>}
        </form>
    );
}
