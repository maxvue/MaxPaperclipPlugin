export const PLANNING_LEADER_IDS = new Set([
  "07a2f2ea-8f1a-4b5e-996c-8821032e8e6d",
  "2105b9d8-249f-4034-8804-bfc270461ac0",
  "971de3fa-de54-4a8f-9d9b-bb1582bdab4d",
  "f5436598-d018-407b-8b13-041c48a7778c",
]);

const INVOKABLE_AGENT_STATUSES = new Set(["active", "idle", "running", "error"]);

export interface ProjectPlanningConfig {
  enabled: boolean;
  planningAgentId: string;
  requireScopeApproval: true;
  requireTechnicalApproval: true;
  updatedAt: string;
}

export function isPlanningLeaderEligible(agent: { id: string; status: string }): boolean {
  return PLANNING_LEADER_IDS.has(agent.id) && INVOKABLE_AGENT_STATUSES.has(agent.status);
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
