import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // The Agent SDK finds its native Claude Code binary, and playwright-core its Chromium, at run time; bundled, they would not.
    serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "playwright-core"]
};

export default nextConfig;
