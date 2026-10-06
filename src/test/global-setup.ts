import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

export async function setup() {
    loadEnvConfig(process.cwd());
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
    const name = new URL(url).pathname.slice(1);
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    execFileSync("pnpm", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
    process.env.DATABASE_URL = url;
}
