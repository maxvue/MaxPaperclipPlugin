/**
 * Motor de Sessões de Chat com Agentes para o MaxPaperclipPlugin
 * Detecta a tela de chat (/chats/:agentRef), monitora mensagens e divisores /new,
 * gerencia sessões e controla a visibilidade no DOM para manter a tela limpa.
 */

import type { ChatSession, ChatMessage } from "./types.js";
import { groupCommentsIntoSessions, type RawIssueComment } from "./store.js";
import { getSettings } from "../../config/settings.js";

export interface ParsedChatRoute {
  isChat: boolean;
  companyPrefix: string | null;
  agentRef: string | null;
}

/**
 * Analisa a URL atual ou fornecida para verificar se é uma tela de chat de agente
 * Rota padrão: /:prefix/chats/:agentRef
 */
export function parseChatRoute(
  pathname: string = typeof window !== "undefined" ? window.location.pathname : "",
): ParsedChatRoute {
  if (!pathname) return { isChat: false, companyPrefix: null, agentRef: null };
  const match = pathname.match(/^\/([^/]+)\/chats\/([^/]+)/);
  if (!match) return { isChat: false, companyPrefix: null, agentRef: null };
  return {
    isChat: true,
    companyPrefix: match[1],
    agentRef: match[2],
  };
}

/**
 * Busca dados da empresa e da issue de chat com o agente
 */
export async function fetchAgentChatContext(
  companyPrefix: string,
  agentRef: string,
): Promise<{ companyId: string; issueId: string | null; comments: RawIssueComment[] } | null> {
  if (typeof window === "undefined") return null;

  try {
    // 1. Resolve o ID da empresa pelo prefixo
    const compRes = await fetch("/api/companies", { credentials: "include" });
    if (!compRes.ok) return null;
    const companies = (await compRes.json()) as Array<{ id: string; issuePrefix: string }>;
    const company = companies.find((c) => c.issuePrefix === companyPrefix || c.id === companyPrefix);
    if (!company) return null;

    // 2. Busca a issue de conversa com o agente
    const chatRes = await fetch(`/api/companies/${company.id}/chats/${encodeURIComponent(agentRef)}`, {
      credentials: "include",
    });
    if (!chatRes.ok) return { companyId: company.id, issueId: null, comments: [] };
    const chatIssue = (await chatRes.json()) as { id: string } | null;

    if (!chatIssue || !chatIssue.id) {
      return { companyId: company.id, issueId: null, comments: [] };
    }

    // 3. Busca comentários existentes na issue
    const commentsRes = await fetch(`/api/issues/${chatIssue.id}/comments`, {
      credentials: "include",
    });
    const comments = commentsRes.ok ? ((await commentsRes.json()) as RawIssueComment[]) : [];

    return {
      companyId: company.id,
      issueId: chatIssue.id,
      comments,
    };
  } catch (err) {
    console.error("[MaxPaperclipPlugin] Erro ao buscar contexto de chat:", err);
    return null;
  }
}

/**
 * Dispara uma nova sessão enviando /new para o agente
 */
export async function sendNewSessionCommand(issueId: string, companyId?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // 1. Tenta enviar diretamente pelo textarea e botão do composer no DOM se presente
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "#main-content textarea, textarea[data-slot='composer-textarea'], div[contenteditable='true']",
  );
  const sendButton = document.querySelector<HTMLButtonElement>(
    "button[data-testid='task-chat-composer-send'], button[aria-label*='Send'], button[title*='Send']",
  );

  // 2. Também dispara via API oficial de comentários para garantir o reset no backend
  if (issueId) {
    try {
      const clientRequestId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}`;
      const res = await fetch(`/api/issues/${issueId}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: "/new",
          clientRequestId,
        }),
      });
      if (res.ok) {
        return true;
      }
    } catch (err) {
      console.error("[MaxPaperclipPlugin] Falha na chamada da API /new:", err);
    }
  }

  // Fallback via DOM
  if (textarea) {
    textarea.value = "/new";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      return true;
    }
  }

  return false;
}

/**
 * Localiza o container flex da interface de chat onde a coluna esquerda deve ser injetada
 */
export function findChatLayoutContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;

  const main = document.getElementById("main-content");
  if (!main) return null;

  // O container grandParent flex-row que engloba a coluna principal
  const surface = main.closest<HTMLElement>(".streamlined-task-detail-surface") || main.parentElement?.parentElement;
  if (surface && surface.classList.contains("flex")) {
    return surface;
  }

  return main.parentElement;
}

/**
 * Aplica filtro de visibilidade no DOM do feed de chat para isolar a sessão ativa
 */
export function applySessionVisibility(
  activeSessionGeneration: number,
  totalSessionsCount: number,
): void {
  if (typeof document === "undefined") return;

  const threadContainer = document.querySelector<HTMLElement>(
    "#main-content [data-testid='task-chat-thread-view'], #main-content .tc-thread-viewport, #main-content",
  );
  if (!threadContainer) return;

  // Encontra todos os marcadores de nova sessão
  const markers = Array.from(threadContainer.querySelectorAll<HTMLElement>(".tc-enter-marker"));
  
  // Se houver apenas 1 sessão (ou 0), todas as mensagens pertencem a ela
  if (markers.length === 0) {
    // Garante que tudo esteja visível
    const hiddenElements = threadContainer.querySelectorAll<HTMLElement>(".max-session-hidden");
    hiddenElements.forEach((el) => el.classList.remove("max-session-hidden"));
    return;
  }

  // Agrupa os nós filhos do thread por bloco de geração
  // Bloco 0: antes do marker 0
  // Bloco 1: do marker 0 até o marker 1
  // ...
  // Bloco K: do marker K-1 até o marker K
  const children = Array.from(threadContainer.children) as HTMLElement[];
  let currentGen = 0;

  for (const child of children) {
    if (child.classList.contains("tc-enter-marker")) {
      currentGen += 1;
    }

    if (currentGen === activeSessionGeneration) {
      child.classList.remove("max-session-hidden");
    } else {
      child.classList.add("max-session-hidden");
    }
  }
}
