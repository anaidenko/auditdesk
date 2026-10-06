import { describe, expect, it } from "vitest";

import { Masker } from "./masker";

const KEY = "8f3c9d2e7a1b4c6d9e0f1a2b3c4d5e6f";
const PEM = [
    "-----BEGIN PRIVATE KEY-----",
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
    "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c2v3b4n5m6",
    "-----END PRIVATE KEY-----"
].join("\n");

describe("Masker", () => {
    it("masks every occurrence of a secret and names the rule", () => {
        const m = new Masker([{ value: KEY, rule: "generic-api-key" }]);
        expect(m.mask(`a=${KEY}; b=${KEY}`)).toBe("a=[secret masked: generic-api-key]; b=[secret masked: generic-api-key]");
    });

    it("masks each line of a multi-line secret, so a line range that cuts it leaks nothing", () => {
        const m = new Masker([{ value: PEM, rule: "private-key" }]);
        const cut = PEM.split("\n").slice(1, 3).join("\n");
        expect(m.mask(cut)).not.toMatch(/MIIEvQ|q1w2e3/);
    });

    it("leaves text without secrets unchanged", () => {
        expect(new Masker([{ value: KEY, rule: "r" }]).mask("nothing here")).toBe("nothing here");
    });

    it("masks a longer secret before a shorter one inside it", () => {
        const m = new Masker([
            { value: "abcd1234", rule: "short" },
            { value: "xxabcd1234yy", rule: "long" }
        ]);
        expect(m.mask("xxabcd1234yy")).toBe("[secret masked: long]");
    });

    it("ignores empty and trivially short values", () => {
        expect(
            new Masker([
                { value: "", rule: "r" },
                { value: "ab", rule: "r" }
            ]).count
        ).toBe(0);
    });

    it("masks strings anywhere inside an object", () => {
        const m = new Masker([{ value: KEY, rule: "r" }]);
        expect(m.maskDeep({ a: [{ b: `k=${KEY}` }], n: 1 })).toEqual({ a: [{ b: "k=[secret masked: r]" }], n: 1 });
    });
});
