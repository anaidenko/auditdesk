import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // The end-to-end tests build into their own folder, so an app already running from .next keeps working.
    distDir: process.env.AUDITDESK_DIST_DIR || ".next",
    // The Agent SDK finds its native Claude Code binary, and playwright-core its Chromium, at run time; bundled, they would not.
    serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "playwright-core"]
};

export default nextConfig;
