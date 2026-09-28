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
 * Garante que a regra CSS para ocultar itens de outras sessões esteja presente na página
 */
export function ensureVisibilityStyles(): void {
  if (typeof document === "undefined") return;
  const styleId = "max-chat-session-visibility-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .max-session-hidden {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }
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

  // 1. Dispara via API oficial de comentários para garantir o reset de contexto no backend
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

  // 2. Fallback via DOM (MDXEditor / textarea)
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "#main-content textarea, textarea[data-slot='composer-textarea']",
  );
  const contentEditable = document.querySelector<HTMLDivElement>(
    "#main-content div[contenteditable='true'], .paperclip-mdxeditor-content",
  );
  const sendButton = document.querySelector<HTMLButtonElement>(
    "button[data-testid='task-chat-composer-send'], button[aria-label*='Send'], button[title*='Send']",
  );

  if (contentEditable) {
    contentEditable.focus();
    document.execCommand("insertText", false, "/new");
    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      return true;
    }
  } else if (textarea) {
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
 * Localiza o elemento container exato onde as mensagens e divisores do chat são montados
 */
export function findChatThreadElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;

  // 1. Container padrão do Paperclip TaskChatThreadView
  const mobileThread = document.querySelector<HTMLElement>(".paperclip-mobile-thread");
  if (mobileThread) return mobileThread;

  // 2. Container geral do thread
  const taskChatThread = document.querySelector<HTMLElement>("[data-testid='task-chat-thread']");
  if (taskChatThread) {
    const inner = taskChatThread.querySelector<HTMLElement>(".paperclip-mobile-thread");
    if (inner) return inner;
  }

  // 3. Fallback: pai dos elementos ancorados
  const anchor = document.querySelector<HTMLElement>("[data-thread-anchor]");
  if (anchor && anchor.parentElement) {
    return anchor.parentElement;
  }

  return null;
}

/**
 * Verifica se um elemento filho do thread representa o início de uma nova sessão (/new)
 */
export function isSessionStartMarker(el: HTMLElement): boolean {
  const marker = el.classList.contains("tc-enter-marker")
    ? el
    : el.querySelector<HTMLElement>(".tc-enter-marker");
  if (!marker) return false;

  const text = (marker.textContent || marker.innerText || "").toLowerCase();
  // Marcadores de início de sessão possuem mensagens como "New session", "Nova sessão", "Earlier messages"
  // e diferem de avisos de falha ("Falha na execução", "Run failed", "Interrupted")
  const isStart =
    text.includes("new session") ||
    text.includes("nova sessão") ||
    text.includes("earlier messages") ||
    marker.getAttribute("data-variant") === "session_start";

  const isFailure =
    text.includes("falha") ||
    text.includes("failed") ||
    text.includes("interrupted") ||
    text.includes("interrompid");

  return isStart && !isFailure;
}

/**
 * Rola a visualização do chat para o final da sessão atual
 */
export function scrollToActiveSession(): void {
  if (typeof document === "undefined") return;
  const viewport = document.querySelector<HTMLElement>(
    ".task-chat-scroll-viewport, [data-testid='task-chat-thread'] .overflow-y-auto, #main-content",
  );
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}

/**
 * Aplica filtro de visibilidade no DOM do feed de chat para isolar a sessão ativa
 */
export function applySessionVisibility(
  activeSessionGeneration: number,
  totalSessionsCount: number,
): void {
  if (typeof document === "undefined") return;

  ensureVisibilityStyles();

  const threadContainer = findChatThreadElement();
  if (!threadContainer) return;

  const children = Array.from(threadContainer.children) as HTMLElement[];
  if (children.length === 0) return;

  // Se houver apenas 1 sessão (ou 0), todas as mensagens devem ficar visíveis
  if (totalSessionsCount <= 1) {
    for (const child of children) {
      child.style.display = "";
      child.classList.remove("max-session-hidden");
    }
    return;
  }

  let currentGen = 0;

  for (const child of children) {
    // Mantém o cabeçalho do agente sempre visível
    if (child.getAttribute("data-testid") === "task-chat-thread-header") {
      child.style.display = "";
      child.classList.remove("max-session-hidden");
      continue;
    }

    const isStartMarker = isSessionStartMarker(child);
    if (isStartMarker) {
      currentGen += 1;
    }

    if (currentGen === activeSessionGeneration) {
      // Se for o marcador de início desta sessão específica, oculta o divisor
      // para que a tela inicie limpa como um chat autônomo
      if (isStartMarker) {
        child.style.display = "none";
        child.classList.add("max-session-hidden");
      } else {
        child.style.display = "";
        child.classList.remove("max-session-hidden");
      }
    } else {
      // Pertence a outra geração (sessão anterior ou posterior) -> Oculta
      child.style.display = "none";
      child.classList.add("max-session-hidden");
    }
  }
}

/**
 * Monitora mutações no feed de chat para manter o filtro de sessão ativo
 * mesmo quando o Paperclip renderizar novas mensagens ou fizer atualizações reativas no DOM
 */
export function monitorThreadVisibility(
  activeSessionGeneration: number,
  totalSessionsCount: number,
): () => void {
  if (typeof document === "undefined") return () => {};

  applySessionVisibility(activeSessionGeneration, totalSessionsCount);

  const container = findChatThreadElement();
  if (!container) {
    const timer = setTimeout(() => {
      applySessionVisibility(activeSessionGeneration, totalSessionsCount);
    }, 300);
    return () => clearTimeout(timer);
  }

  let rafId: number | null = null;
  const reapply = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      applySessionVisibility(activeSessionGeneration, totalSessionsCount);
    });
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        reapply();
        break;
      }
    }
  });

  observer.observe(container, { childList: true });

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    observer.disconnect();
  };
}
