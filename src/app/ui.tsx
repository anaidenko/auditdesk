import type { ReactNode } from "react";

import { shortSha } from "@/engine/short-sha";

export function cx(...classes: (string | false | null | undefined)[]): string {
    return classes.filter(Boolean).join(" ");
}

const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

export const button = {
    primary: `${base} bg-zinc-900 text-white shadow-sm hover:bg-zinc-700`,
    secondary: `${base} bg-white text-zinc-800 shadow-sm ring-1 ring-zinc-300 ring-inset hover:bg-zinc-50`,
    success: `${base} bg-emerald-600 text-white shadow-sm hover:bg-emerald-500`,
    danger: `${base} bg-white text-red-700 shadow-sm ring-1 ring-red-300 ring-inset hover:bg-red-50`,
    small: "px-2.5 py-1.5 text-xs"
};

/** A form control with no width of its own; `input` is the full-width one. */
export const field =
    "block rounded-lg border-0 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-300 ring-inset placeholder:text-zinc-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-zinc-100";

export const input = `${field} w-full`;

export const label = "block text-xs font-medium tracking-wide text-zinc-600 uppercase";

export function Card({
    title,
    description,
    actions,
    children,
    className,
    as: Tag = "div"
}: {
    title?: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
    className?: string;
    as?: "div" | "section";
}) {
    return (
        <Tag className={cx("rounded-xl border border-zinc-200 bg-white shadow-sm", className)}>
            {(title || actions) && (
                <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
                    <div>
                        {title && <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>}
                        {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
                    </div>
                    {actions}
                </div>
            )}
            {children && <div className="px-5 py-4">{children}</div>}
        </Tag>
    );
}

export function PageHeader({
    eyebrow,
    title,
    actions,
    children
}: {
    eyebrow?: ReactNode;
    title: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
                {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-indigo-600 uppercase">{eyebrow}</div>}
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
                {children && <div className="mt-1.5 text-sm text-zinc-500">{children}</div>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
    );
}

type Tone = "zinc" | "red" | "orange" | "amber" | "sky" | "violet" | "emerald" | "teal" | "blue" | "slate";

const TONES: Record<Tone, string> = {
    zinc: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
    slate: "bg-white text-zinc-500 ring-zinc-300",
    red: "bg-red-50 text-red-700 ring-red-600/20",
    orange: "bg-orange-50 text-orange-700 ring-orange-600/20",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
    sky: "bg-sky-50 text-sky-700 ring-sky-600/20",
    violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    teal: "bg-teal-50 text-teal-700 ring-teal-600/20",
    blue: "bg-blue-50 text-blue-700 ring-blue-600/20"
};

const RECHECK: Record<string, { tone: Tone; words: string }> = {
    unchanged: { tone: "zinc", words: "code unchanged" },
    open: { tone: "amber", words: "confirmed open" },
    fixed: { tone: "emerald", words: "fixed" },
    changed: { tone: "sky", words: "code changed, verify" },
    regressed: { tone: "red", words: "regressed" }
};

/** What the last re-audit found of a finding, at which commit (design § 9). */
export function RecheckBadge({ recheck, sha }: { recheck: string | null; sha: string | null }) {
    if (!recheck) return null;
    const r = RECHECK[recheck];
    return (
        <Badge tone={r.tone} data-testid="recheck">
            {r.words}
            {sha && <span className="font-mono opacity-70">{shortSha(sha)}</span>}
        </Badge>
    );
}

export function Badge({
    tone = "zinc",
    dot,
    pulse,
    className,
    children,
    ...rest
}: {
    "tone"?: Tone;
    "dot"?: boolean;
    "pulse"?: boolean;
    "className"?: string;
    "children": ReactNode;
    "data-testid"?: string;
}) {
    return (
        <span
            className={cx(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
                TONES[tone],
                className
            )}
            {...rest}
        >
            {dot && <span aria-hidden className={cx("size-1.5 rounded-full bg-current", pulse && "animate-pulse")} />}
            {children}
        </span>
    );
}

const SEVERITY_TONE: Record<string, Tone> = { critical: "red", high: "orange", medium: "amber", low: "sky", info: "zinc" };

export function SeverityBadge({ severity }: { severity: string | null }) {
    return (
        <Badge tone={severity ? (SEVERITY_TONE[severity] ?? "zinc") : "violet"} className="w-[5.5rem] justify-center uppercase">
            {severity ?? "question"}
        </Badge>
    );
}

const FINDING_TONE: Record<string, Tone> = {
    unreviewed: "slate",
    accepted: "emerald",
    edited: "teal",
    rejected: "red",
    excluded: "zinc",
    merged: "zinc",
    superseded: "zinc"
};

export function FindingStatus({ status }: { status: string }) {
    return <Badge tone={FINDING_TONE[status] ?? "zinc"}>{status}</Badge>;
}

const RUN_TONE: Record<string, Tone> = {
    "queued": "zinc",
    "running": "blue",
    "pending": "zinc",
    "done": "emerald",
    "partial": "amber",
    "declined": "amber",
    "failed": "red",
    "interrupted": "amber",
    "stopped": "zinc",
    "not started": "slate"
};

export function RunStatus({ status, testId }: { status: string; testId?: string }) {
    return (
        <Badge tone={RUN_TONE[status] ?? "zinc"} dot pulse={status === "running" || status === "queued"} data-testid={testId}>
            {status}
        </Badge>
    );
}

export function Alert({ tone = "amber", children }: { tone?: "amber" | "red"; children: ReactNode }) {
    return (
        <p
            role="status"
            className={cx(
                "rounded-lg px-3.5 py-2.5 text-sm ring-1 ring-inset",
                tone === "red" ? "bg-red-50 text-red-800 ring-red-200" : "bg-amber-50 text-amber-900 ring-amber-200"
            )}
        >
            {children}
        </p>
    );
}

export function FormError({ children }: { children: ReactNode }) {
    return <p className="basis-full text-sm text-red-700">{children}</p>;
}

/** Stroke icons, drawn on a 24-unit grid. */
const ICONS: Record<string, ReactNode> = {
    shield: <path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.3-7.5 9.5-4.4-1.2-7.5-4.9-7.5-9.5V6L12 3z M8.8 12.2l2.2 2.2 4.4-4.6" />,
    branch: (
        <>
            <circle cx="6" cy="6" r="2" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="8" r="2" />
            <path d="M6 8v8 M18 10c0 4-6 3-11.2 6.4" />
        </>
    ),
    play: <path d="M8 5.5v13l10.5-6.5L8 5.5z" />,
    download: <path d="M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19.5h14" />,
    search: (
        <>
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-4.2-4.2" />
        </>
    ),
    arrow: <path d="M5 12h14 M13 6l6 6-6 6" />,
    list: <path d="M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01" />,
    refresh: <path d="M20 11a8 8 0 00-14.3-4.8L4 8 M4 4v4h4 M4 13a8 8 0 0014.3 4.8L20 16 M20 20v-4h-4" />,
    lock: (
        <>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 018 0v3" />
        </>
    ),
    folder: <path d="M3.5 7.5A2 2 0 015.5 5.5h4l2 2.5h7a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2v-10z" />
};

export function Icon({ name, className = "size-4" }: { name: keyof typeof ICONS; className?: string }) {
    return (
        <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            {ICONS[name]}
        </svg>
    );
}
