function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => (resolve = r));
    return { promise, resolve };
}

/** Long enough for any response to finish streaming after one of its tool calls started. */
const CEILING_MS = 10 * 60_000;

/**
 * The stop reason of the main-thread response that made each tool call. The CLI starts a call
 * while its response still streams (Task E.1, Deviation 5), and runs tools and hooks in its own
 * order while the stream reaches us in another, so a writing tool and the PostToolBatch hook wait
 * here for the response's end. null: the response never ended (an API error, the session closed),
 * or the ceiling passed first, so no path the engine does not know can hang a run and the queue.
 */
export class Responses {
    private streaming: string[] = [];
    private waits = new Map<string, ReturnType<typeof deferred<string | null>>>();

    constructor(private readonly ceilingMs = CEILING_MS) {}

    toolUse(id: string): void {
        this.streaming.push(id);
    }

    end(stopReason: string | null): void {
        for (const id of this.streaming) this.slot(id).resolve(stopReason);
        this.streaming = [];
    }

    /** Releases every call still waiting: no response will end for it. */
    abort(): void {
        this.streaming = [];
        for (const d of this.waits.values()) d.resolve(null);
    }

    stopReasonOf(id: string): Promise<string | null> {
        const { promise } = this.slot(id);
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(null), this.ceilingMs);
            void promise.then(reason => {
                clearTimeout(timer);
                resolve(reason);
            });
        });
    }

    private slot(id: string) {
        let d = this.waits.get(id);
        if (!d) this.waits.set(id, (d = deferred<string | null>()));
        return d;
    }
}
