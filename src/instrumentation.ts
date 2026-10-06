export async function register() {
    // Not awaited past the import: register() must finish before the server serves requests.
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    // The runner never starts inside `next build` (Task 1.2 records whether register() runs there).
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { startRunner } = await import("./server/runner");
    startRunner();
}
