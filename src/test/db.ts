import { prisma } from "@/server/db";

export async function resetDb() {
    await prisma.$executeRawUnsafe(
        `TRUNCATE "RunEvent", "ApiCall", "Finding", "AgentRun", "Job", "Run", "Repository", "Project" RESTART IDENTITY CASCADE`
    );
}
