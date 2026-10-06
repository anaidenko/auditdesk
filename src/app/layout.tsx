import type { Metadata } from "next";
import Link from "next/link";

import { DEFAULT_EFFORT, DEFAULT_MODEL } from "@/engine/agent/request";

import "./globals.css";
import { Icon } from "./ui";

export const metadata: Metadata = { title: "Auditdesk", description: "A local code-audit workbench" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
                <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/85 backdrop-blur">
                    <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
                        <Link href="/" className="flex items-center gap-2.5">
                            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm">
                                <Icon name="shield" className="size-[18px]" />
                            </span>
                            <span className="text-[15px] font-semibold tracking-tight">Auditdesk</span>
                        </Link>
                        <Link href="/" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
                            Projects
                        </Link>
                        <Link href="/settings" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">
                            Settings
                        </Link>
                        <div className="ml-auto flex items-center gap-2 text-xs">
                            <span className="hidden items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-600 sm:inline-flex">
                                {DEFAULT_MODEL} · effort {DEFAULT_EFFORT}
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 ring-1 ring-emerald-600/20 ring-inset">
                                <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
                                Local · 127.0.0.1
                            </span>
                        </div>
                    </nav>
                </header>
                <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
            </body>
        </html>
    );
}
