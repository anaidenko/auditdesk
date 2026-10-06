import { describe, expect, it } from "vitest";

import { git } from "@/engine/git";
import { makeRepo } from "@/test/git-repo";

import { Masker } from "../masker";

import { leakInTree, leakMasks } from "./index";
import type { GitleaksLeak } from "./types";

// A private key gitleaks finds only after decoding: Secret holds the decoded text, never seen in the file.
// Assembled at run time, so this file itself carries no key for the pre-commit scan.
const LABEL = ["RSA", "PRIVATE", "KEY"].join(" ");
const PEM = `-----BEGIN ${LABEL}-----\nMIIEowIBAAKCAQEA${"x".repeat(60)}\n${"q".repeat(64)}\n-----END ${LABEL}-----\n`;
const ENCODED = Buffer.from(PEM).toString("base64");

async function decodedLeak() {
    const repo = await makeRepo({ "config.env": `APP=1\nSA_B64=${ENCODED}\nOTHER=2\n` });
    const leak: GitleaksLeak = {
        RuleID: "private-key",
        Description: "Identified a Private Key",
        File: "config.env",
        StartLine: 2,
        EndLine: 2,
        Match: PEM,
        Secret: PEM,
        Commit: await git(["rev-parse", "HEAD"], repo),
        Date: "2026-10-06T00:00:00Z",
        Tags: ["decoded:base64", "decode-depth:1"]
    };
    return { repo, leak };
}

describe("leaks gitleaks found inside an encoded string", () => {
    it("masks the encoded line, which is what the agent would read", async () => {
        const { repo, leak } = await decodedLeak();
        const masker = new Masker(await leakMasks(repo, [leak]));
        expect(masker.mask(`SA_B64=${ENCODED}`)).not.toContain(ENCODED.slice(0, 40));
    });

    it("counts the secret as still in the code", async () => {
        const { repo, leak } = await decodedLeak();
        expect(await leakInTree(repo, leak)).toBe(true);
    });
});
