const ALLOWED = new Set(["localhost", "127.0.0.1"]);

/** Under DNS rebinding the attacker's name arrives in Host; only this allowlist stops it (design § 12). */
export function isAllowedHost(host: string | null): boolean {
    if (!host) return false;
    return ALLOWED.has(host.toLowerCase().replace(/:\d+$/, ""));
}
