import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A proxy that refuses every request and records it. Set as HTTPS_PROXY and HTTP_PROXY (with
 * NO_PROXY for loopback), it shows whether a test's subprocess tried to leave the machine.
 */
export async function startConnectSpy() {
    const attempts: string[] = [];
    const server = createServer((req, res) => {
        attempts.push(`${req.method} ${req.url}`);
        res.writeHead(403).end();
    });
    server.on("connect", (req, socket) => {
        attempts.push(`CONNECT ${req.url}`);
        // After "connect" the socket is ours: a client that resets the refused tunnel (Linux CI does)
        // raises ECONNRESET on it, which is uncaught without a listener.
        socket.on("error", () => {});
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}`,
        attempts,
        close: () =>
            new Promise<void>(resolve => {
                server.closeAllConnections();
                server.close(() => resolve());
            })
    };
}
