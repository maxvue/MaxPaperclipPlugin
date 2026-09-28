import type { ChatSession, ChatMessage } from "./types.js";

const CUSTOM_TITLES_KEY_PREFIX = "max:chat-sessions:custom-titles:";
const ARCHIVED_SESSIONS_KEY_PREFIX = "max:chat-sessions:archived:";
const DELETED_SESSIONS_KEY_PREFIX = "max:chat-sessions:deleted:";

export function getCustomTitlesKey(companyId: string, agentRef: string): string {
  return `${CUSTOM_TITLES_KEY_PREFIX}${companyId}:${agentRef}`;
}

export function getArchivedSessionsKey(companyId: string, agentRef: string): string {
  return `${ARCHIVED_SESSIONS_KEY_PREFIX}${companyId}:${agentRef}`;
}

export function getDeletedSessionsKey(companyId: string, agentRef: string): string {
  return `${DELETED_SESSIONS_KEY_PREFIX}${companyId}:${agentRef}`;
}

export function loadCustomTitles(companyId: string, agentRef: string): Record<string, string> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(getCustomTitlesKey(companyId, agentRef));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCustomTitle(companyId: string, agentRef: string, sessionId: string, newTitle: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const titles = loadCustomTitles(companyId, agentRef);
    titles[sessionId] = newTitle.trim();
    window.localStorage.setItem(getCustomTitlesKey(companyId, agentRef), JSON.stringify(titles));
  } catch (err) {
    console.error("[MaxPaperclipPlugin] Erro ao salvar título customizado de sessão:", err);
  }
}

export function loadArchivedSessionIds(companyId: string, agentRef: string): Set<string> {
  if (typeof window === "undefined" || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(getArchivedSessionsKey(companyId, agentRef));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

export function saveArchivedSessionIds(companyId: string, agentRef: string, ids: Set<string>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(getArchivedSessionsKey(companyId, agentRef), JSON.stringify(Array.from(ids)));
  } catch (err) {
    console.error("[MaxPaperclipPlugin] Erro ao salvar sessões arquivadas:", err);
  }
}

export function archiveSession(companyId: string, agentRef: string, sessionId: string): void {
  const archived = loadArchivedSessionIds(companyId, agentRef);
  archived.add(sessionId);
  saveArchivedSessionIds(companyId, agentRef, archived);
}

export function unarchiveSession(companyId: string, agentRef: string, sessionId: string): void {
  const archived = loadArchivedSessionIds(companyId, agentRef);
  archived.delete(sessionId);
  saveArchivedSessionIds(companyId, agentRef, archived);
}

export function loadDeletedSessionIds(companyId: string, agentRef: string): Set<string> {
  if (typeof window === "undefined" || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(getDeletedSessionsKey(companyId, agentRef));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

export function saveDeletedSessionIds(companyId: string, agentRef: string, ids: Set<string>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(getDeletedSessionsKey(companyId, agentRef), JSON.stringify(Array.from(ids)));
  } catch (err) {
    console.error("[MaxPaperclipPlugin] Erro ao salvar sessões deletadas:", err);
  }
}

export function deleteSessionPermanently(companyId: string, agentRef: string, sessionId: string): void {
  const deleted = loadDeletedSessionIds(companyId, agentRef);
  deleted.add(sessionId);
  saveDeletedSessionIds(companyId, agentRef, deleted);

  // Se a sessão estiver na lista de arquivadas, limpa também
  const archived = loadArchivedSessionIds(companyId, agentRef);
  if (archived.has(sessionId)) {
    archived.delete(sessionId);
    saveArchivedSessionIds(companyId, agentRef, archived);
  }
}

export function generateSessionTitle(firstUserText: string | null | undefined, sessionIndex: number): string {
  if (!firstUserText || !firstUserText.trim()) {
    return `Sessão ${sessionIndex + 1}`;
  }
  const clean = firstUserText.trim().replace(/^[/@#]\w+\s*/, ""); // remove comandos como /ask
  if (!clean) return `Sessão ${sessionIndex + 1}`;
  
  const singleLine = clean.split("\n")[0].trim();
  if (singleLine.length <= 36) return singleLine;
  
  const truncated = singleLine.slice(0, 35);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 15) {
    return truncated.slice(0, lastSpace).trim() + "…";
  }
  return truncated.trim() + "…";
}

export interface RawIssueComment {
  id: string;
  body?: string | null;
  authorUserId?: string | null;
  authorAgentId?: string | null;
  authorType?: string | null;
  conversationSessionGeneration?: number | null;
  createdAt: string | Date;
  clientRequestId?: string | null;
}

/**
 * Agrupa comentários brutos de uma Issue em sessões separadas por /new ou conversationSessionGeneration
 */
export function groupCommentsIntoSessions(
  companyId: string,
  agentRef: string,
  issueId: string,
  comments: RawIssueComment[],
): { sessions: ChatSession[]; messagesBySession: Map<string, ChatMessage[]> } {
  const customTitles = loadCustomTitles(companyId, agentRef);
  const archivedIds = loadArchivedSessionIds(companyId, agentRef);
  const deletedIds = loadDeletedSessionIds(companyId, agentRef);

  const sessions: ChatSession[] = [];
  const messagesBySession = new Map<string, ChatMessage[]>();

  // Ordena cronologicamente
  const sorted = [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let currentGen = 0;
  let currentSessionId = `session-gen-${currentGen}`;
  let currentMessages: ChatMessage[] = [];
  let firstUserText: string | null = null;
  let sessionCreatedAt = sorted[0] ? new Date(sorted[0].createdAt).toISOString() : new Date().toISOString();
  let sessionUpdatedAt = sessionCreatedAt;

  const pushCurrentSession = (index: number) => {
    // Registra mensagens para visibilidade no thread mesmo se a sessão foi excluída
    messagesBySession.set(currentSessionId, [...currentMessages]);

    // Se a sessão foi deletada definitivamente, não adiciona ao array de sessões exibidas
    if (deletedIds.has(currentSessionId)) {
      return;
    }

    const snippet = currentMessages.length > 0
      ? currentMessages[currentMessages.length - 1].text.slice(0, 70).replace(/\n/g, " ")
      : "Nova sessão iniciada";

    const customTitle = customTitles[currentSessionId];
    const title = customTitle || generateSessionTitle(firstUserText, index);
    const isArchived = archivedIds.has(currentSessionId);

    sessions.push({
      id: currentSessionId,
      agentRef,
      companyId,
      issueId,
      generation: currentGen,
      title,
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      messagesCount: currentMessages.length,
      snippet,
      isCustomTitle: Boolean(customTitle),
      isArchived,
      isDeleted: false,
    });
  };

  for (const comment of sorted) {
    const isBoundary =
      comment.conversationSessionGeneration != null ||
      comment.body?.trim() === "/new";

    if (isBoundary) {
      // Fecha a sessão atual e inicia a próxima
      pushCurrentSession(currentGen);
      currentGen += 1;
      currentSessionId = `session-gen-${currentGen}`;
      currentMessages = [];
      firstUserText = null;
      sessionCreatedAt = new Date(comment.createdAt).toISOString();
      sessionUpdatedAt = sessionCreatedAt;
      continue;
    }

    const text = comment.body ?? "";
    const isUser = Boolean(comment.authorUserId && !comment.authorAgentId && comment.authorType !== "agent");
    const authorKind = isUser ? "user" : comment.authorType === "system" ? "system" : "agent";

    if (isUser && !firstUserText && text.trim()) {
      firstUserText = text.trim();
    }

    sessionUpdatedAt = new Date(comment.createdAt).toISOString();

    currentMessages.push({
      id: comment.id,
      author: authorKind,
      text,
      createdAt: new Date(comment.createdAt).toISOString(),
      sessionGeneration: currentGen,
      clientRequestId: comment.clientRequestId,
    });
  }

  // Empurra a sessão ativa final
  pushCurrentSession(currentGen);

  return { sessions, messagesBySession };
}

/**
 * Filtra sessões por termo de busca no título ou nas mensagens internas,
 * com suporte opcional para filtrar apenas arquivadas ou apenas ativas.
 */
export function filterSessions(
  sessions: ChatSession[],
  messagesBySession: Map<string, ChatMessage[]>,
  query: string,
  onlyArchived?: boolean,
): ChatSession[] {
  let list = sessions;
  if (onlyArchived !== undefined) {
    list = list.filter((s) => (onlyArchived ? Boolean(s.isArchived) : !s.isArchived));
  }

  const q = query.trim().toLowerCase();
  if (!q) return list;

  return list.filter((session) => {
    if (session.title.toLowerCase().includes(q)) return true;
    const messages = messagesBySession.get(session.id) ?? [];
    return messages.some((m) => m.text.toLowerCase().includes(q));
  });
}

let currentActiveSessionId: string | null = null;
const activeSessionListeners = new Set<(id: string | null) => void>();

export const activeChatSessionStore = {
  get(): string | null {
    return currentActiveSessionId;
  },
  set(id: string | null) {
    if (currentActiveSessionId === id) return;
    currentActiveSessionId = id;
    for (const listener of activeSessionListeners) {
      listener(id);
    }
  },
  subscribe(listener: (id: string | null) => void): () => void {
    activeSessionListeners.add(listener);
    return () => {
      activeSessionListeners.delete(listener);
    };
  },
};
