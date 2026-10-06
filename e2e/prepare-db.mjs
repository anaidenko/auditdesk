// Recreates the end-to-end database and applies the migrations, before the web server starts.
import { execFileSync } from "node:child_process";
import pg from "pg";

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
