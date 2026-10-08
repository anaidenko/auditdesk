"use client";

import { type ReactNode, useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { FormState } from "@/app/actions";

/**
 * A form whose Server Action returns a refusal as text, shown beside the form instead of an error page,
 * or a notice of what it did. The notice fades, so it never contradicts a later action of another form
 * on the same finding; it is gone while the form's next submission runs, so each one shows it afresh.
 */
export function ActionForm({
    action,
    className,
    children
}: {
    action: (prev: FormState, fd: FormData) => Promise<FormState>;
    className?: string;
    children: ReactNode;
}) {
    const [state, formAction, pending] = useActionState(action, { error: null });
    return (
        <form action={formAction} className={className} aria-busy={pending}>
            {children}
            {state.error && <p className="basis-full text-sm text-red-700">{state.error}</p>}
            {state.notice && !pending && (
                <p role="status" className="animate-notice self-center text-xs font-medium text-emerald-700">
                    {state.notice}
                </p>
            )}
        </form>
    );
}

/** A submit button that is disabled while its form's action runs, so a click shows and cannot repeat. */
export function SubmitButton({ className, disabled, children }: { className: string; disabled?: boolean; children: ReactNode }) {
    const { pending } = useFormStatus();
    return (
        <button disabled={disabled || pending} className={className}>
            {children}
        </button>
    );
}
