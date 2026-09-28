const INVOKABLE_AGENT_STATUSES = new Set(["active", "idle", "running", "error"]);

export interface ProjectPlanningConfig {
  enabled: boolean;
  planningAgentId: string;
  requireScopeApproval: true;
  requireTechnicalApproval: true;
  updatedAt: string;
}

export function isPlanningLeaderEligible(agent: { id: string; status: string }): boolean {
  return Boolean(agent.id) && INVOKABLE_AGENT_STATUSES.has(agent.status);
}

export function buildProjectPlanningConfig(
  planningAgentId: string,
  updatedAt = new Date().toISOString(),
): ProjectPlanningConfig {
  return {
    enabled: true,
    planningAgentId,
    requireScopeApproval: true,
    requireTechnicalApproval: true,
    updatedAt,
  };
}
