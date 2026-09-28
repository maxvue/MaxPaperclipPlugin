/**
 * Tipos e Modelos para o Módulo de Múltiplos Chats e Sessões com Agentes
 */

export type ChatAuthorKind = "user" | "agent" | "system";

export interface ChatMessage {
  id: string;
  author: ChatAuthorKind;
  text: string;
  createdAt: string;
  sessionGeneration?: number | null;
  clientRequestId?: string | null;
}

export interface ChatSession {
  id: string; // Ex: "session-gen-0", "session-gen-1", etc.
  agentRef: string;
  companyId: string;
  issueId: string;
  generation: number; // Identificador da geração (cada /new incrementa)
  title: string;
  createdAt: string;
  updatedAt: string;
  messagesCount: number;
  snippet: string;
  isCustomTitle?: boolean;
  isArchived?: boolean;
  isDeleted?: boolean;
}

export interface ChatSessionsState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  searchQuery: string;
  loading: boolean;
  error: string | null;
}
