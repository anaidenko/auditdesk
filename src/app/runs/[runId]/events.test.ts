import { describe, expect, it } from "vitest";

import { mergeEvents } from "./events";

const e = (id: string) => ({ id, level: "info", message: `event ${id}`, at: "2026-10-06T12:00:00.000Z" });

describe("mergeEvents", () => {
    it("shows each event once when a reconnected stream sends the log again", () => {
        expect(mergeEvents([e("1"), e("2")], [e("1"), e("2"), e("3")]).map(x => x.id)).toEqual(["1", "2", "3"]);
    });
});
