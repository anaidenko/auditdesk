import { expect, vi } from "vitest";

// "unit" files run in parallel, and the test database holds one file's rows at a time.
vi.mock("@/server/db", () => ({
    prisma: new Proxy(
        {},
        {
            get() {
                throw new Error(`${expect.getState().testPath} reaches the test database: move it under a "db" glob in vitest.config.mts`);
            }
        }
    )
}));
