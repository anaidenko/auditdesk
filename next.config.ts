import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // The Agent SDK finds its native Claude Code binary with require.resolve at run time; bundled, it would not.
    serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"]
};

export default nextConfig;
