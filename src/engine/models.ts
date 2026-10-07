import type { Effort } from "./agent/request";

/** What the run form offers (design § 8): the default first; another choice is Andrii's to make per run. */
export const MODEL_CHOICES = [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" }
] as const;

export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export const modelLabel = (id: string) => MODEL_CHOICES.find(m => m.id === id)?.label ?? id;
