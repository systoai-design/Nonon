import { PageHeader } from "./ui";
import { GmailCard } from "./connections/GmailCard";
import { PairedDevices } from "./connections/PairedDevices";
import { ProviderCards } from "./connections/ProviderCards";
import { WorkspaceAiPanel } from "./connections/RolesPanel";

export interface ConnectionsViewProps {
  workspaceId: string | null;
}

export function ConnectionsView({ workspaceId }: ConnectionsViewProps) {
  return (
    <section className="scroll-y h-full">
      <div className="col flex flex-col gap-6 pt-4 pb-8">
        <PageHeader subtitle="Optional links to your Gmail and to online AI like Claude. Everything here is off until you turn it on." />
        <GmailCard workspaceId={workspaceId} />
        <ProviderCards />
        {workspaceId && <WorkspaceAiPanel workspaceId={workspaceId} />}
        <PairedDevices workspaceId={workspaceId} />
      </div>
    </section>
  );
}
