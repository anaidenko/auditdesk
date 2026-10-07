// Recreates the end-to-end database and applies the migrations, before the web server starts.
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import pg from "pg";

// Saved credentials from an earlier run must not leak into this one.
const home = process.env.AUDITDESK_HOME ?? "";
if (!home.startsWith("/tmp/")) throw new Error(`AUDITDESK_HOME must be under /tmp/ for the end-to-end server, not "${home}"`);
rmSync(home, { recursive: true, force: true });

// The eval results the Evals page reads, copied so the spot-check page never writes into the repository.
const evals = process.env.AUDITDESK_EVAL_RESULTS ?? "";
if (!evals.startsWith("/tmp/")) throw new Error(`AUDITDESK_EVAL_RESULTS must be under /tmp/ for the end-to-end server, not "${evals}"`);
rmSync(evals, { recursive: true, force: true });
cpSync("e2e/fixtures/eval-results", evals, { recursive: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set for the end-to-end server");
const name = new URL(url).pathname.slice(1);
const admin = new URL(url);
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
await client.query(`CREATE DATABASE "${name}"`);
await client.end();
execFileSync("pnpm", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
