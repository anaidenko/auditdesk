"use client";

import { type ReactNode, useActionState } from "react";

import type { FormState } from "@/app/actions";

/** A form whose Server Action returns a refusal as text, shown beside the form instead of an error page. */
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
        </form>
    );
}
