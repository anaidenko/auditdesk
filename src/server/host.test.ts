import { describe, expect, it } from "vitest";

import { isAllowedHost } from "./host";

describe("isAllowedHost", () => {
    it.each(["localhost:3000", "127.0.0.1:3000", "LOCALHOST", "127.0.0.1"])("allows %s", h => expect(isAllowedHost(h)).toBe(true));
    it.each(["evil.example", "evil.example:3000", "127.0.0.1.evil.example", "", null])("refuses %j", h =>
        expect(isAllowedHost(h)).toBe(false)
    );
});
