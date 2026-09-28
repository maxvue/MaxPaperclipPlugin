export type TaskRelationType = "created_from" | "child" | "mentioned" | "linked";

export interface RelatedTask {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  priority?: string | null;
  relationType: TaskRelationType;
  createdAt: string;
  updatedAt: string;
}

export interface SubagentExecution {
  id: string;
  name: string;
  role: string;
  status: "running" | "done" | "idle" | "error";
  runtimeMode?: string | null;
  timestamp?: string | null;
}

export interface ArtifactItem {
  id: string;
  name: string;
  type: "document" | "attachment" | "file" | "plan";
  path?: string | null;
  size?: number | null;
  downloadUrl?: string | null;
  createdAt?: string | null;
}

export interface ExecutionMetrics {
  totalSubagents: number;
  totalArtifacts: number;
  totalEdits: number;
  toolsCount: number;
  durationSeconds: number;
  formattedDuration?: string;
  tokensEstimate?: number | null;
}

export interface ChatContextData {
  tasks: RelatedTask[];
  subagents: SubagentExecution[];
  artifacts: ArtifactItem[];
  metrics: ExecutionMetrics;
}

export type ScopeMode = "session" | "agent";
