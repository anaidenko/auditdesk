import { Client } from "pg";
import "server-only";

export const RUN_CHANNEL = "run_events";

/** A dedicated connection for LISTEN; Prisma Client has no LISTEN (design § 5). */
export async function listen(onRun: (runId: string) => void): Promise<() => Promise<void>> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    client.on("notification", n => n.payload && onRun(n.payload));
    await client.query(`LISTEN ${RUN_CHANNEL}`);
    return async () => {
        await client.end().catch(() => {});
    };
}
