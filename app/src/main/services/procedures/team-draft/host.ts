import type { CloudPolicy, ProjectRoles, ProviderId, RoleName } from "../../../../shared/contracts";
import type { StageDeps } from "../../providers/stages";

/** What the procedure needs from the provider service. ProcedureRunContext carries no services, so the provider service binds this at start-up. */
export interface TeamDraftHost {
  deps: StageDeps;
  /** Read live on every run: the policy may have changed since the roles were set. */
  policy(workspaceId: string): CloudPolicy | undefined;
  setRole(workspaceId: string, role: RoleName, provider: ProviderId | "local" | null): ProjectRoles;
}

let host: TeamDraftHost | null = null;

export function bindTeamDraftHost(next: TeamDraftHost | null): void {
  host = next;
}

export function teamDraftHost(): TeamDraftHost | null {
  return host;
}
