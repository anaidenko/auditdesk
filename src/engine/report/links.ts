/** The hosts whose tree and commit pages are known, and the path of each on the host. */
const HOSTS: Record<string, { tree: string; commit: string }> = {
    "github.com": { tree: "/tree/", commit: "/commit/" },
    "gitlab.com": { tree: "/-/tree/", commit: "/-/commit/" },
    "bitbucket.org": { tree: "/src/", commit: "/commits/" }
};

export interface RepoLinks {
    repo: string;
    branch: string;
    commit: string | null;
}

/**
 * Web links for a repository cloned from a known host; null for a local path or another host. Built
 * from the host and the path alone, so the credentials a source URL may hold never reach a report.
 */
export function repoLinks(source: string, branch: string, sha: string | null): RepoLinks | null {
    const s = source.trim();
    const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(s);
    let host: string;
    let path: string;
    if (scp) [host, path] = [scp[1], scp[2]];
    else {
        let url: URL;
        try {
            url = new URL(s);
        } catch {
            return null;
        }
        if (!["https:", "ssh:"].includes(url.protocol)) return null;
        [host, path] = [url.hostname, url.pathname];
    }
    const forms = HOSTS[host.toLowerCase()];
    const segments = path
        .replace(/\/+$/, "")
        .replace(/\.git$/i, "")
        .split("/")
        .filter(Boolean);
    if (!forms || segments.length < 2) return null;
    const repo = `https://${host.toLowerCase()}/${segments.map(encodeURIComponent).join("/")}`;
    return {
        repo,
        branch: `${repo}${forms.tree}${branch.split("/").map(encodeURIComponent).join("/")}`,
        commit: sha && /^[0-9a-f]{40}$/.test(sha) ? `${repo}${forms.commit}${sha}` : null
    };
}

/** An http or https address from the auditor's settings, or null. */
export function webUrl(value: string | undefined): string | null {
    try {
        const url = new URL(value?.trim() ?? "");
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
        return null;
    }
}
