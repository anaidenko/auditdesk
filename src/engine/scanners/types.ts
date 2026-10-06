export type ScannerTool = "gitleaks" | "osv" | "semgrep";

export interface Mount {
    host: string;
    container: string;
}

export interface ScannerRunner {
    /** Returns whatever the scanner exited with; `runScanners` decides which exit codes are failures. */
    run(tool: ScannerTool, args: string[], mounts: Mount[]): Promise<ScannerOutput>;
    digest(tool: ScannerTool): Promise<string>;
}

export interface ScannerOutput {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface Ruleset {
    name: string;
    file: string;
    sha256: string;
    rules: number;
}

export interface ToolVersions {
    images: Record<ScannerTool, { image: string; digest: string }>;
    rulesets: Omit<Ruleset, "file">[];
    osvQueriedAt: string;
}

export interface GitleaksLeak {
    RuleID: string;
    Description: string;
    File: string;
    StartLine: number;
    EndLine: number;
    Match: string;
    Secret: string;
    Commit: string;
    Date: string;
    /** `decoded:base64` and the like when gitleaks found the secret inside an encoded string. */
    Tags?: string[];
}

export interface OsvPackage {
    source: string;
    name: string;
    version: string;
    ecosystem: string;
    vulnerabilities: { id: string; aliases: string[]; summary: string }[];
    maxSeverity: number | null;
}

export interface SemgrepResult {
    check_id: string;
    path: string;
    start: { line: number };
    end: { line: number };
    extra: { message: string; severity: string; lines: string; metadata: { cwe?: string[] | string; references?: string[] } };
}
