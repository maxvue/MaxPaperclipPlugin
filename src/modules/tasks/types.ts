export interface IssueSummary {
  id: string;
  companyId: string;
  projectId?: string | null;
  parentId?: string | null;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  identifier?: string | null;
  issueNumber?: number | null;
  createdAt: string;
  updatedAt: string;
  hiddenAt?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  executionRunId?: string | null;
}

export interface LiveRun {
  id: string;
  agentId?: string | null;
  agentName?: string | null;
  status?: string | null;
  runtimeMode?: string | null;
  livenessState?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
}

export interface ProjectSummary {
  id: string;
  companyId: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  leadAgentId?: string | null;
  codebase?: Record<string, unknown> | null;
  primaryWorkspace?: Record<string, unknown> | null;
  workspaces?: Array<Record<string, unknown>> | null;
}

export interface ExecuteProjectTaskOptions {
  companyId?: string;
  rootDir?: string;
  projectName?: string;
}

export interface PlanningLeaderSummary {
  id: string;
  name: string;
  title?: string | null;
  status: string;
}

export interface ProjectPlanningConfig {
  enabled: boolean;
  planningAgentId: string;
  requireScopeApproval: true;
  requireTechnicalApproval: true;
  updatedAt: string;
}

export interface PlanningBootstrap {
  leaders: PlanningLeaderSummary[];
  configurations: Record<string, ProjectPlanningConfig | null>;
}
