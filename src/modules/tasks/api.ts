import type { ExecuteProjectTaskOptions, IssueSummary, LiveRun, ProjectSummary } from "./types.js";

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
 * Busca todas as tarefas da empresa (ativas e opcionalmente arquivadas).
 */
export async function fetchCompanyTasks(
  companyId: string,
  includeArchived = true,
): Promise<IssueSummary[]> {
  try {
    const raw = await hostFetchJson<IssueSummary[] | { issues: IssueSummary[] }>(
      `/api/companies/${companyId}/issues?limit=250`,
    );
    const list = Array.isArray(raw) ? raw : (raw?.issues ?? []);
    if (!includeArchived) {
      return list.filter((item) => !item.hiddenAt);
    }
    return list;
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

/**
 * Arquiva uma tarefa (marcando hiddenAt e/ou arquivando da inbox).
 */
export async function archiveIssue(issueId: string): Promise<boolean> {
  try {
    // 1. Tenta atualizar hiddenAt via PATCH na issue
    await hostFetchJson(`/api/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({ hiddenAt: new Date().toISOString() }),
    });

    // 2. Tenta também arquivar da inbox
    try {
      await hostFetchJson(`/api/issues/${issueId}/inbox-archive`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      // Ignora se o endpoint de inbox-archive falhar
    }

    return true;
  } catch (err) {
    console.warn(`Erro ao arquivar tarefa ${issueId}:`, err);
    return false;
  }
}

/**
 * Desarquiva uma tarefa (limpando hiddenAt).
 */
export async function unarchiveIssue(issueId: string): Promise<boolean> {
  try {
    // 1. Atualiza hiddenAt como null via PATCH
    await hostFetchJson(`/api/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({ hiddenAt: null }),
    });

    // 2. Tenta também remover do inbox-archive se existir
    try {
      await hostFetchJson(`/api/issues/${issueId}/inbox-archive`, {
        method: "DELETE",
      });
    } catch {
      // Ignora erro
    }

    return true;
  } catch (err) {
    console.warn(`Erro ao desarquivar tarefa ${issueId}:`, err);
    return false;
  }
}

export interface TaskExecutionResult {
  success: boolean;
  status: "parado" | "rodando" | "erro";
  pid?: number;
  message?: string;
}

export interface TaskLogsResult {
  projectId: string;
  taskType: "dev" | "build";
  status: "parado" | "rodando" | "erro";
  logs: string[];
  pid?: number;
  startedAt?: string;
}

/**
 * Aciona execução de task do projeto (dev ou build) através do Task Manager do plugin.
 */
export async function executeProjectTask(
  projectId: string,
  taskType: "dev" | "build",
  action: "start" | "stop" | "toggle" = "toggle",
  options?: ExecuteProjectTaskOptions,
): Promise<TaskExecutionResult> {
  try {
    const res = await hostFetchJson<{ data?: TaskExecutionResult } | TaskExecutionResult>(
      `/api/plugins/max.paperclip-plugin/bridge/action`,
      {
        method: "POST",
        body: JSON.stringify({
          key: "task-manager:execute",
          params: {
            projectId,
            taskType,
            action,
            companyId: options?.companyId,
            rootDir: options?.rootDir,
            projectName: options?.projectName,
          },
        }),
      },
    );
    const actualResult =
      res && typeof res === "object" && "data" in res && (res as { data?: TaskExecutionResult }).data
        ? (res as { data: TaskExecutionResult }).data
        : (res as TaskExecutionResult);
    return actualResult;
  } catch (err) {
    console.warn(`Erro ao acionar task ${taskType} do projeto ${projectId}:`, err);
    return {
      success: false,
      status: "erro",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Busca status de todas as tasks ativas gerenciadas pelo plugin.
 */
export async function fetchTaskStatuses(): Promise<
  Record<string, { status: "parado" | "rodando" | "erro"; pid?: number; exitCode?: number | null }>
> {
  try {
    return await hostFetchJson<
      Record<string, { status: "parado" | "rodando" | "erro"; pid?: number; exitCode?: number | null }>
    >(`/api/plugins/max.paperclip-plugin/bridge/data`, {
      method: "POST",
      body: JSON.stringify({
        key: "task-manager:status",
        params: {},
      }),
    });
  } catch (err) {
    console.warn("Erro ao buscar status de tasks do plugin:", err);
    return {};
  }
}

/**
 * Busca buffer de logs da task do projeto.
 */
export async function fetchTaskLogs(
  projectId: string,
  taskType: "dev" | "build",
): Promise<TaskLogsResult | null> {
  try {
    return await hostFetchJson<TaskLogsResult>(
      `/api/plugins/max.paperclip-plugin/bridge/data`,
      {
        method: "POST",
        body: JSON.stringify({
          key: "task-manager:logs",
          params: { projectId, taskType },
        }),
      },
    );
  } catch (err) {
    console.warn(`Erro ao buscar logs da task ${taskType} de ${projectId}:`, err);
    return null;
  }
}

/**
 * Limpa o buffer de logs da task.
 */
export async function clearTaskLogs(
  projectId: string,
  taskType: "dev" | "build",
): Promise<boolean> {
  try {
    await hostFetchJson(`/api/plugins/max.paperclip-plugin/bridge/action`, {
      method: "POST",
      body: JSON.stringify({
        key: "task-manager:clear-logs",
        params: { projectId, taskType },
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove permanentemente uma tarefa via DELETE /api/issues/:id.
 */
export async function deleteIssue(issueId: string): Promise<boolean> {
  try {
    await hostFetchJson(`/api/issues/${issueId}`, {
      method: "DELETE",
    });
    return true;
  } catch (err) {
    console.warn(`Erro ao remover tarefa permanentemente ${issueId}:`, err);
    return false;
  }
}

/**
 * Remove uma tarefa e todas as suas subtarefas vinculadas em cascata.
 * As tarefas-filhas são removidas primeiro para evitar violações de chave estrangeira.
 */
export async function deleteIssueCascade(issueId: string, childIds: string[]): Promise<boolean> {
  try {
    // 1. Remove primeiro todas as subtarefas vinculadas
    for (const childId of childIds) {
      const childSuccess = await deleteIssue(childId);
      if (!childSuccess) {
        console.warn(`Aviso: falha ao remover subtarefa ${childId}, prosseguindo com as demais.`);
      }
    }

    // 2. Remove a tarefa principal
    return await deleteIssue(issueId);
  } catch (err) {
    console.warn(`Erro na remoção em cascata da tarefa ${issueId}:`, err);
    return false;
  }
}
