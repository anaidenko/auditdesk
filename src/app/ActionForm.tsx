"use client";

import { type ReactNode, useActionState } from "react";
import { createPortal, useFormStatus } from "react-dom";

import type { FormState } from "@/app/actions";

/**
 * A form whose Server Action returns a refusal as text, shown beside the form instead of an error page,
 * or a notice of what it did, shown as a toast in the layout's #toasts: beside the button, it pushed
 * the row's other controls aside. The toast fades, so it never contradicts a later action; it is gone
 * while the form's next submission runs, so each one shows it afresh.
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
            {state.notice && !pending && <Toast text={state.notice} />}
        </form>
    );
}

function Toast({ text }: { text: string }) {
    const toast = (
        <p className="flex animate-notice items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4 text-emerald-400">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {text}
        </p>
    );
    const region = document.getElementById("toasts");
    return region ? createPortal(toast, region) : toast;
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
