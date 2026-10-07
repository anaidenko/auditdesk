import { connect } from "node:net";
import { describe, expect, it } from "vitest";

import { startConnectSpy } from "./connect-spy";

describe("startConnectSpy", () => {
    it("records a CONNECT and survives a client that resets the tunnel after the refusal", async () => {
        const spy = await startConnectSpy();
        const { port } = new URL(spy.url);
        const refused = await new Promise<string>((resolve, reject) => {
            const client = connect(Number(port), "127.0.0.1", () =>
                client.write("CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\n")
            );
            client.on("error", reject);
            client.once("data", data => {
                client.resetAndDestroy();
                resolve(data.toString());
            });
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        await spy.close();
        expect(refused).toMatch(/^HTTP\/1\.1 403/);
        expect(spy.attempts).toEqual(["CONNECT api.anthropic.com:443"]);
    });
});
