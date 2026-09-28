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

/**
 * Aciona execução de task do projeto (dev ou build).
 */
export async function executeProjectTask(
  projectId: string,
  taskType: "dev" | "build",
): Promise<boolean> {
  try {
    // Tenta disparar comando no workspace de runtime do projeto se disponível
    await hostFetchJson(`/api/projects/${projectId}/tasks/${taskType}/run`, {
      method: "POST",
      body: JSON.stringify({ task: taskType }),
    });
    return true;
  } catch {
    // Se o backend não tiver o endpoint mapeado, o frontend mantém o controle de estado e feedback visual
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
