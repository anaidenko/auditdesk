import { describe, expect, it } from "vitest";

import { gitEnv } from "./git";

describe("gitEnv", () => {
    it("never lets git or ssh wait for a typed password", () => {
        const env = gitEnv({ PATH: "/usr/bin" });
        expect(env.GIT_TERMINAL_PROMPT).toBe("0");
        expect(env.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes");
    });

    it("keeps an ssh command the auditor set", () => {
        expect(gitEnv({ GIT_SSH_COMMAND: "ssh -i ~/.ssh/audit" }).GIT_SSH_COMMAND).toBe("ssh -i ~/.ssh/audit");
    });
});
