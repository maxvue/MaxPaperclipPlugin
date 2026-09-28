import type { IssueSummary, LiveRun, ProjectSummary } from "./types.js";

export async function hostFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let errorMsg = `Falha na requisição: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) errorMsg = body.error;
    } catch {
      const text = await response.text();
      if (text) errorMsg = text;
    }
    throw new Error(errorMsg);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return {} as T;
}

/**
 * Busca todas as tarefas da empresa que não estejam arquivadas.
 */
export async function fetchCompanyTasks(companyId: string): Promise<IssueSummary[]> {
  try {
    const raw = await hostFetchJson<IssueSummary[] | { issues: IssueSummary[] }>(
      `/api/companies/${companyId}/issues?limit=100`,
    );
    const list = Array.isArray(raw) ? raw : (raw?.issues ?? []);
    // Filtra tarefas arquivadas (hiddenAt não nulo)
    return list.filter((item) => !item.hiddenAt);
  } catch (err) {
    console.warn("Erro ao buscar tarefas da empresa:", err);
    return [];
  }
}

/**
 * Busca projetos da empresa para mapear os nomes e cores.
 */
export async function fetchCompanyProjects(companyId: string): Promise<ProjectSummary[]> {
  try {
    const raw = await hostFetchJson<ProjectSummary[] | { projects: ProjectSummary[] }>(
      `/api/companies/${companyId}/projects`,
    );
    return Array.isArray(raw) ? raw : (raw?.projects ?? []);
  } catch (err) {
    console.warn("Erro ao buscar projetos da empresa:", err);
    return [];
  }
}

/**
 * Busca execuções ao vivo de agentes na empresa.
 */
export async function fetchCompanyLiveRuns(companyId: string): Promise<LiveRun[]> {
  try {
    const raw = await hostFetchJson<LiveRun[] | { liveRuns: LiveRun[] }>(
      `/api/companies/${companyId}/live-runs`,
    );
    return Array.isArray(raw) ? raw : (raw?.liveRuns ?? []);
  } catch (err) {
    console.warn("Erro ao buscar execuções ativas:", err);
    return [];
  }
}

/**
 * Busca execuções ao vivo específicas de uma tarefa.
 */
export async function fetchIssueLiveRuns(issueId: string): Promise<LiveRun[]> {
  try {
    const raw = await hostFetchJson<LiveRun[] | { liveRuns: LiveRun[] }>(
      `/api/issues/${issueId}/live-runs`,
    );
    return Array.isArray(raw) ? raw : (raw?.liveRuns ?? []);
  } catch (err) {
    console.warn(`Erro ao buscar execuções da tarefa ${issueId}:`, err);
    return [];
  }
}
