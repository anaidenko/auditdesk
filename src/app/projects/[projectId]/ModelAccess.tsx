import Link from "next/link";

import { setModelAccess } from "@/app/actions";
import { ACCESS_LABEL, ACCESS_TOOLTIP, credentialText } from "@/app/model-access";
import { Card, button } from "@/app/ui";
import type { CredentialStatus } from "@/engine/credentials";
import type { ModelAccess as Access } from "@/engine/types";

export function ModelAccessCard({ projectId, access, status }: { projectId: string; access: Access; status: CredentialStatus }) {
    return (
        <Card
            as="section"
            title="Model access"
            description="Where this project's audits run. A run keeps the access it started with."
            actions={<AccessInfo />}
        >
            <form action={setModelAccess.bind(null, projectId)} className="flex flex-wrap items-center gap-4 text-sm">
                {(["claude_plan", "api_key"] as const).map(a => (
                    <label key={a} className="flex items-center gap-2 text-zinc-700">
                        <input
                            type="radio"
                            name="modelAccess"
                            value={a}
                            defaultChecked={access === a}
                            className="size-4 accent-indigo-600"
                        />
                        {ACCESS_LABEL[a]}
                        {a === "claude_plan" && <span className="text-zinc-400">(default)</span>}
                    </label>
                ))}
                <button className={`${button.secondary} ${button.small}`}>Apply</button>
            </form>
            <p className="mt-3 text-sm text-zinc-600" data-testid="credential-status">
                {access === "claude_plan" ? "Claude plan token" : "API key"}: {credentialText(status)}
                {status.source === "none" && (
                    <>
                        {" · "}
                        <Link href="/settings" className="underline">
                            add it in Settings
                        </Link>
                    </>
                )}
            </p>
        </Card>
    );
}

function AccessInfo() {
    return (
        <details className="relative">
            <summary
                aria-label="About model access"
                className="grid size-6 cursor-pointer list-none place-items-center rounded-full text-zinc-400 hover:text-zinc-700"
            >
                ⓘ
            </summary>
            <div
                role="tooltip"
                className="absolute right-0 z-10 mt-2 w-96 space-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-xs leading-relaxed text-zinc-600 shadow-lg"
            >
                {ACCESS_TOOLTIP.map(p => (
                    <p key={p.slice(0, 16)}>{p}</p>
                ))}
            </div>
        </details>
    );
}
