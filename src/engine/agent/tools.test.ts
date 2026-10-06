import { describe, expect, it } from "vitest";

import { parseChecklist } from "../checklists";
import { Masker } from "../masker";
import { MemorySink } from "../memory-sink";

import { makeTools } from "./tools";

const ctx = {
    clonePath: "/nonexistent",
    repositoryId: "r",
    agentRunId: "a",
    aspect: "security",
    checklist: parseChecklist("security", "# Security\n\n## SEC-01 Item\n"),
    masker: new Masker([]),
    repoMap: "",
    sink: new MemorySink(),
    state: { finished: null, reported: [], fatal: null }
};

describe("makeTools", () => {
    // The cached prefix starts with these definitions (design § 8): a refactor must not move a byte.
    it("declares the same seven tools as before the shared specs, byte for byte", async () => {
        type Declared = { name: string; description: string; input_schema: unknown; strict: boolean };
        const declared = makeTools(ctx).map(t => {
            const { name, description, input_schema, strict } = t as unknown as Declared;
            return { name, description, input_schema, strict };
        });
        await expect(JSON.stringify(declared, null, 2)).toMatchFileSnapshot("./__snapshots__/tools.json");
    });
});
