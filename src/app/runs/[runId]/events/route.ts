import { listen } from "@/server/pg";
import { runSnapshot } from "@/server/queries";

export const dynamic = "force-dynamic";

/** GET only and read-only (design § 12). Re-reads the run on each NOTIFY and every 5 s, so a missed notification costs nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
    const { runId } = await params;
    const encoder = new TextEncoder();
    let after = BigInt(0);
    let closed = false;
    let chain = Promise.resolve();
    let stopListening = async () => {};
    let timer: NodeJS.Timeout | undefined;

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const close = async () => {
                if (closed) return;
                closed = true;
                clearInterval(timer);
                await stopListening();
                try {
                    controller.close();
                } catch {
                    // Already cancelled by the runtime.
                }
            };
            const push = () =>
                (chain = chain
                    .then(async () => {
                        if (closed) return;
                        const snap = await runSnapshot(runId, after);
                        // The client may have gone while the run was being read.
                        if (closed) return;
                        if (snap.events.length) after = BigInt(snap.events.at(-1)!.id);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(snap)}\n\n`));
                        if (snap.terminal) await close();
                    })
                    // A failed read ends this stream; the page reconnects and re-reads the run.
                    .catch(() => close()));
            // Registered before the await: a client that leaves while LISTEN is being set up must still close it.
            request.signal.addEventListener("abort", () => void close());
            const stop = await listen(id => id === runId && void push());
            if (closed || request.signal.aborted) {
                await stop();
                await close();
                return;
            }
            stopListening = stop;
            timer = setInterval(push, 5000);
            await push();
        },
        async cancel() {
            closed = true;
            clearInterval(timer);
            await stopListening();
        }
    });
    return new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive" }
    });
}
