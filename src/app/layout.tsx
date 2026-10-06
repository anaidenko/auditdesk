import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = { title: "Auditdesk", description: "A local code-audit workbench" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
                <header className="border-b border-zinc-200 bg-white">
                    <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3 text-sm">
                        <Link href="/" className="font-semibold">
                            Auditdesk
                        </Link>
                        <span className="text-zinc-500">local · 127.0.0.1</span>
                    </nav>
                </header>
                <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
            </body>
        </html>
    );
}
