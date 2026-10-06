import { describe, expect, it } from "vitest";

import { makeRepo } from "@/test/git-repo";

import { Masker } from "./masker";
import { buildRepoMap } from "./repomap";

const files = {
    "package.json": JSON.stringify({ name: "app", main: "server.js", scripts: { start: "node server.js", test: "vitest" } }),
    "server.js": 'app.get("/users/:id", h);\nrouter.post("/login", login);\nconst k = process.env.STRIPE_KEY;\n',
    "src/app/dashboard/page.tsx": "export default function P() {}",
    "src/app/api/orders/route.ts": "export async function GET() {}",
    "prisma/schema.prisma": "model User {\n  id Int @id\n}\nmodel Order {\n  id Int @id\n}\n",
    "migrations/001_init.sql": "create table x();",
    ".env.example": "DATABASE_URL=\nSECRET=abcdef123456\n", // gitleaks:allow (a planted example value)
    "test/login.test.js": "",
    ".github/workflows/ci.yml": ""
};

describe("buildRepoMap", () => {
    it("lists entry points, routes, data schema, environment variables and tests", async () => {
        const root = await makeRepo(files);
        const map = await buildRepoMap(root, new Masker([]));
        expect(map).toContain("package.json main: server.js");
        expect(map).toContain("GET /users/:id (server.js:1)");
        expect(map).toContain("POST /login (server.js:2)");
        expect(map).toContain("page /dashboard (src/app/dashboard/page.tsx)");
        expect(map).toContain("route /api/orders (src/app/api/orders/route.ts)");
        expect(map).toMatch(/Prisma models: User, Order/);
        expect(map).toContain("migrations/001_init.sql");
        expect(map).toMatch(/STRIPE_KEY/);
        expect(map).toMatch(/DATABASE_URL/);
        expect(map).toContain("test/login.test.js");
        expect(map).toContain(".github/workflows/ci.yml");
    });

    it("names environment variables but never their example values", async () => {
        const root = await makeRepo(files);
        expect(await buildRepoMap(root, new Masker([]))).not.toContain("abcdef123456");
    });

    it("is byte-identical for the same tree", async () => {
        const root = await makeRepo(files);
        expect(await buildRepoMap(root, new Masker([]))).toBe(await buildRepoMap(root, new Masker([])));
    });

    it("stays under its size limit and says so", async () => {
        // The map summarises by directory, so only many directories make it long.
        const many = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`src/d${i}/f.ts`, ""]));
        const map = await buildRepoMap(await makeRepo(many), new Masker([]), { maxChars: 5000 });
        expect(map.length).toBeLessThanOrEqual(5000);
        expect(map).toMatch(/map cut at 5000 characters/);
    });
});
