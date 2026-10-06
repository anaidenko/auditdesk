import type { BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { makeTools } from "./tools";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Sonnet 5.5, not Sonnet 5: Sonnet 5 takes no task budget.
export const DEFAULT_MODEL = "claude-sonnet-5-5";
// The docs' starting point for well-specified multistep tool use on Sonnet 5.5, one below its default.
export const DEFAULT_EFFORT: Effort = "medium";

export const BETAS = ["server-side-fallback-2026-07-01", "task-budgets-2026-03-13", "thinking-display-updates-2026-08-18"];

// Thinking counts toward max_tokens; 64K is the skill's figure for long agentic turns, and needs streaming.
export const MAX_TOKENS = 64_000;

export function agentParams(o: {
    model: string;
    effort: Effort;
    system: BetaTextBlockParam[];
    tools: ReturnType<typeof makeTools>;
    messages: { role: "user" | "assistant"; content: unknown }[];
    taskBudget: number;
    maxIterations: number;
}) {
    return {
        model: o.model,
        max_tokens: MAX_TOKENS,
        stream: true as const,
        max_iterations: o.maxIterations,
        betas: BETAS,
        fallbacks: "default" as const,
        thinking: { type: "adaptive" as const, display: "updates" as const },
        output_config: { effort: o.effort, task_budget: { type: "tokens" as const, total: o.taskBudget } },
        // Top-level caching adds the second breakpoint at the end of the history on every request (design § 8).
        cache_control: { type: "ephemeral" as const },
        tool_choice: { type: "auto" as const },
        system: o.system,
        tools: o.tools,
        messages: o.messages as never
    };
}
