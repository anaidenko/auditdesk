"use client";

import { useActionState } from "react";

import type { FormState } from "@/app/actions";
import { removeCredentialAction, saveCredentialAction } from "@/app/credential-actions";
import { FormError, button, input } from "@/app/ui";
import type { CredentialStatus } from "@/engine/credentials";
import type { ModelAccess } from "@/engine/types";

export function CredentialForm({
    access,
    label,
    status,
    source
}: {
    access: ModelAccess;
    label: string;
    status: string;
    source: CredentialStatus["source"];
}) {
    const [state, action, pending] = useActionState<FormState, FormData>(saveCredentialAction.bind(null, access), { error: null });
    return (
        <div className="space-y-3">
            <p className="text-sm text-zinc-700" data-testid={`status-${access}`}>
                {status}
            </p>
            {source === "env" && <p className="text-sm text-zinc-500">Edit .env.local to change it.</p>}
            {/* An unusable saved file: the status above says how to fix it; saving would fail on it too. */}
            {(source === "saved" || source === "none") && (
                <form action={action} className="flex flex-wrap gap-3">
                    <input
                        name="value"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`${label} value`}
                        placeholder={source === "saved" ? "Paste a new value to replace it" : "Paste the value"}
                        className={`${input} min-w-64 flex-1`}
                    />
                    <button disabled={pending} className={button.secondary}>
                        {source === "saved" ? "Replace" : "Save"}
                    </button>
                </form>
            )}
            {source === "saved" && (
                <form action={removeCredentialAction.bind(null, access)}>
                    <button className={`${button.danger} ${button.small}`}>Remove</button>
                </form>
            )}
            {state.error && <FormError>{state.error}</FormError>}
        </div>
    );
}
