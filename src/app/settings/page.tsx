import { credentialText } from "@/app/model-access";
import { Card, PageHeader } from "@/app/ui";
import { credentialStatus } from "@/engine/credentials";

import { CredentialForm } from "./CredentialForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
    const [plan, key] = await Promise.all([credentialStatus("claude_plan"), credentialStatus("api_key")]);
    return (
        <div className="space-y-8">
            <PageHeader eyebrow="Settings" title="Credentials">
                Write-only: a saved value is never shown again. A value in .env.local wins over a saved one. Saved values live in
                ~/.auditdesk/credentials.json (mode 0600), never in the database.
            </PageHeader>
            <Card as="section" title="Claude plan token" description="CLAUDE_CODE_OAUTH_TOKEN, printed once by `claude setup-token`.">
                <CredentialForm access="claude_plan" label="Claude plan token" status={credentialText(plan)} source={plan.source} />
            </Card>
            <Card as="section" title="API key" description="ANTHROPIC_API_KEY, from the Claude Console.">
                <CredentialForm access="api_key" label="API key" status={credentialText(key)} source={key.source} />
            </Card>
        </div>
    );
}
