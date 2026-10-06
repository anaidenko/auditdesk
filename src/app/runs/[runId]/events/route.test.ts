import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { RUN_CHANNEL } from "@/server/pg";
import { resetDb } from "@/test/db";
import { projectWithRepo } from "@/test/factories";

import { GET } from "./route";

beforeEach(resetDb);

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("the run's event stream", () => {
    it("writes nothing after the client has gone, even when a read was in flight", async () => {
        const { project } = await projectWithRepo();
        const run = await prisma.run.create({
            data: { projectId: project.id, model: "m", effort: "medium", aspects: ["security"], budgetUsd: 1, budgetTokens: 20000 }
        });
        const client = new AbortController();
        const res = await GET(new Request(`http://127.0.0.1/runs/${run.id}/events`, { signal: client.signal }), {
            params: Promise.resolve({ runId: run.id })
        });
        const reader = res.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('"status":"queued"');

        const rejections: unknown[] = [];
        const record = (e: unknown) => rejections.push(e);
        process.on("unhandledRejection", record);

        // Hold the next read: a lock on RunEvent blocks the snapshot until it is released.
        const locker = new Client({ connectionString: process.env.DATABASE_URL });
        await locker.connect();
        await locker.query("BEGIN");
        await locker.query('LOCK TABLE "RunEvent" IN ACCESS EXCLUSIVE MODE');
        await prisma.$executeRaw`SELECT pg_notify(${RUN_CHANNEL}, ${run.id})`;
        await pause(200);
        client.abort();
        await pause(200);
        await locker.query("ROLLBACK");
        await locker.end();
        await pause(300);
        process.off("unhandledRejection", record);
        // Before the fix: "TypeError: Invalid state: Controller is already closed".
        expect(rejections).toEqual([]);
    });

    it("leaves no LISTEN connection behind when the client goes before the stream is set up", async () => {
        const { project } = await projectWithRepo();
        const run = await prisma.run.create({
            data: { projectId: project.id, model: "m", effort: "low", aspects: ["security"], budgetUsd: 1, budgetTokens: 20000 }
        });
        const listening = async () =>
            Number(
                (
                    await prisma.$queryRaw<
                        { n: bigint }[]
                    >`SELECT count(*) AS n FROM pg_stat_activity WHERE query = ${`LISTEN ${RUN_CHANNEL}`}`
                )[0].n
            );
        const before = await listening();
        const client = new AbortController();
        client.abort();
        const res = await GET(new Request(`http://127.0.0.1/runs/${run.id}/events`, { signal: client.signal }), {
            params: Promise.resolve({ runId: run.id })
        });
        await res.body?.cancel().catch(() => {});
        await pause(500);
        expect(await listening()).toBe(before);
    });
});
