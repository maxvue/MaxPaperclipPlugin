import type { RelatedTask, ArtifactItem } from "./types.js";
import { hostFetchJson } from "../tasks/api.js";
import type { IssueSummary } from "../tasks/types.js";

interface IssueDetailResponse {
  id: string;
  projectId?: string | null;
  documentSummaries?: Array<{
    id: string;
    key?: string;
    title?: string;
    createdAt?: string;
  }>;
}

interface IssueAttachmentResponse {
  id: string;
  filename?: string;
  contentType?: string;
  byteSize?: number;
  createdAt?: string;
}

/**
 * Busca tarefas relacionadas à conversa atual com base em:
 * 1. createdFromIssueId === chatIssueId
 * 2. parentId === chatIssueId
 * 3. Identificadores mencionados (ex.: ENG-42) no texto das mensagens
 */
export async function fetchRelatedTasks(
  companyId: string,
  chatIssueId: string,
  mentionedIdentifiers: string[] = [],
): Promise<RelatedTask[]> {
  try {
    const raw = await hostFetchJson<IssueSummary[] | { issues: IssueSummary[] }>(
      `/api/companies/${companyId}/issues?limit=250`,
    );
    const list: IssueSummary[] = Array.isArray(raw) ? raw : (raw?.issues ?? []);
    const mentionedSet = new Set(mentionedIdentifiers.map((id) => id.toUpperCase()));

    const relatedMap = new Map<string, RelatedTask>();

    for (const item of list) {
      // Ignora a própria conversa de chat
      if (item.id === chatIssueId) continue;

      let relType: RelatedTask["relationType"] | null = null;

      // 1. Criada a partir desta conversa
      const createdFrom = (item as any).createdFromIssueId;
      if (createdFrom === chatIssueId) {
        relType = "created_from";
      } else if (item.parentId === chatIssueId) {
        relType = "child";
      } else if (item.identifier && mentionedSet.has(item.identifier.toUpperCase())) {
        relType = "mentioned";
      }

      if (relType && !relatedMap.has(item.id)) {
        relatedMap.set(item.id, {
          id: item.id,
          identifier: item.identifier,
          title: item.title,
          status: item.status,
          priority: item.priority,
          relationType: relType,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        });
      }
    }

    return Array.from(relatedMap.values());
  } catch (err) {
    console.warn("[MaxPaperclipPlugin] Erro ao buscar tarefas relacionadas:", err);
    return [];
  }
}

/**
 * Busca documentos vinculados e anexos da issue para consolidar artefatos
 */
export async function fetchIssueDocumentsAndAttachments(
  issueId: string,
): Promise<{ documents: any[]; attachments: any[] }> {
  try {
    const [issueRes, attachRes] = await Promise.all([
      hostFetchJson<IssueDetailResponse>(`/api/issues/${issueId}`).catch(() => null),
      hostFetchJson<IssueAttachmentResponse[] | { attachments: IssueAttachmentResponse[] }>(
        `/api/issues/${issueId}/attachments`,
      ).catch(() => []),
    ]);

    const documents = issueRes?.documentSummaries || [];
    const attachments = Array.isArray(attachRes) ? attachRes : (attachRes?.attachments ?? []);

    return { documents, attachments };
  } catch (err) {
    console.warn("[MaxPaperclipPlugin] Erro ao buscar documentos/anexos da issue:", err);
    return { documents: [], attachments: [] };
  }
}

/**
 * Cria uma nova tarefa vinculada à conversa atual
 */
export async function createNewLinkedTask(
  companyId: string,
  parentIssueId: string,
  title: string,
  projectId?: string | null,
): Promise<IssueSummary | null> {
  try {
    let resolvedProjectId = projectId;

    // Se projectId não foi fornecido, tenta descobrir via issue atual ou lista de projetos da empresa
    if (!resolvedProjectId) {
      const issueRes = await hostFetchJson<IssueDetailResponse>(`/api/issues/${parentIssueId}`).catch(() => null);
      if (issueRes?.projectId) {
        resolvedProjectId = issueRes.projectId;
      } else {
        const projects = await hostFetchJson<Array<{ id: string; status?: string }>>(
          `/api/companies/${companyId}/projects`,
        ).catch(() => []);
        const activeProj = Array.isArray(projects) ? projects.find((p) => p.status !== "archived") || projects[0] : null;
        if (activeProj?.id) {
          resolvedProjectId = activeProj.id;
        }
      }
    }

    const payload: Record<string, unknown> = {
      title,
      status: "todo",
      priority: "medium",
      createdFromIssueId: parentIssueId,
    };
    if (resolvedProjectId) {
      payload.projectId = resolvedProjectId;
    }

    // Cria a tarefa vinculada à conversa via createdFromIssueId
    try {
      const created = await hostFetchJson<IssueSummary>(`/api/companies/${companyId}/issues`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return created;
    } catch {
      // Se a API exigir parentId, faz fallback tentando com parentId
      const createdWithParent = await hostFetchJson<IssueSummary>(`/api/companies/${companyId}/issues`, {
        method: "POST",
        body: JSON.stringify({ ...payload, parentId: parentIssueId }),
      });
      return createdWithParent;
    }
  } catch (err) {
    console.error("[MaxPaperclipPlugin] Erro ao criar tarefa vinculada:", err);
    return null;
  }
}
