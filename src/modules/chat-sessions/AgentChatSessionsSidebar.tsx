import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, Search, X, PanelLeftClose, PanelLeft, RefreshCw, MessageSquareDashed } from "lucide-react";
import type { ChatSession, ChatMessage } from "./types.js";
import {
  parseChatRoute,
  fetchAgentChatContext,
  sendNewSessionCommand,
  applySessionVisibility,
  monitorThreadVisibility,
  scrollToActiveSession,
  findChatLayoutContainer,
} from "./engine.js";
import {
  groupCommentsIntoSessions,
  filterSessions,
  saveCustomTitle,
  type RawIssueComment,
} from "./store.js";
import { SessionItem } from "./SessionItem.js";
import { getSettings, subscribeSettings } from "../../config/settings.js";

const SIDEBAR_WIDTH_KEY = "max:chat-sessions:sidebar-width";
const DEFAULT_WIDTH = 270;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
      return parsed;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

export function AgentChatSessionsSidebar() {
  const [moduleEnabled, setModuleEnabled] = useState(() => getSettings().chatSessions);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(readStoredWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);

  const [routeInfo, setRouteInfo] = useState(() => parseChatRoute());
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [rawComments, setRawComments] = useState<RawIssueComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(findChatLayoutContainer);

  useEffect(() => {
    const updateTarget = () => {
      const target = findChatLayoutContainer();
      if (target) {
        setContainer((prev) => (prev !== target ? target : prev));
      }
    };

    updateTarget();
    const observer = new MutationObserver(() => updateTarget());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return subscribeSettings((s) => {
      setModuleEnabled(s.chatSessions);
    });
  }, []);

  // Limpa estados ao trocar de agente
  useEffect(() => {
    setActiveSessionId(null);
    setRawComments([]);
    setIssueId(null);
    setSearchQuery("");
  }, [routeInfo.agentRef, routeInfo.companyPrefix]);

  // Monitora alterações na URL para ativar na rota de chat
  useEffect(() => {
    const handleUrlChange = () => {
      const current = parseChatRoute();
      setRouteInfo(current);
    };

    window.addEventListener("popstate", handleUrlChange);
    // Observer de mutações para SPA navigation
    const obs = new MutationObserver(() => {
      const current = parseChatRoute();
      if (
        current.isChat !== routeInfo.isChat ||
        current.agentRef !== routeInfo.agentRef ||
        current.companyPrefix !== routeInfo.companyPrefix
      ) {
        setRouteInfo(current);
      }
    });

    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("popstate", handleUrlChange);
      obs.disconnect();
    };
  }, [routeInfo]);

  // Carrega comentários e contexto da conversa do agente
  const refreshChatData = useCallback(async (silent = false) => {
    if (!routeInfo.isChat || !routeInfo.companyPrefix || !routeInfo.agentRef) {
      return;
    }
    if (!silent) setLoading(true);

    try {
      const ctx = await fetchAgentChatContext(routeInfo.companyPrefix, routeInfo.agentRef);
      if (ctx) {
        setCompanyId(ctx.companyId);
        setIssueId(ctx.issueId);
        setRawComments(ctx.comments);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [routeInfo]);

  useEffect(() => {
    refreshChatData();
  }, [refreshChatData]);

  // Agrupa comentários em sessões
  const { sessions, messagesBySession } = useMemo(() => {
    if (!companyId || !routeInfo.agentRef || !issueId) {
      // Se não há issue criada ainda, representa 1 sessão inicial vazia
      const initialSession: ChatSession = {
        id: "session-gen-0",
        agentRef: routeInfo.agentRef || "",
        companyId: companyId || "",
        issueId: "",
        generation: 0,
        title: "Sessão 1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messagesCount: 0,
        snippet: "Nova conversa",
      };
      return {
        sessions: [initialSession],
        messagesBySession: new Map([["session-gen-0", []]]),
      };
    }

    return groupCommentsIntoSessions(companyId, routeInfo.agentRef, issueId, rawComments);
  }, [companyId, routeInfo.agentRef, issueId, rawComments]);

  // Define a sessão ativa inicial se ainda não selecionada
  useEffect(() => {
    if (sessions.length > 0) {
      if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
        // Por padrão, seleciona a última sessão (a mais recente)
        const lastSession = sessions[sessions.length - 1];
        setActiveSessionId(lastSession.id);
      }
    }
  }, [sessions, activeSessionId]);

  // Monitora e aplica o filtro de visibilidade no DOM do feed de chat
  useEffect(() => {
    if (!activeSessionId) return;
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session) {
      return monitorThreadVisibility(session.generation, sessions.length);
    }
  }, [activeSessionId, sessions]);

  // Manipulador de clique em uma sessão
  const handleSelectSession = (session: ChatSession) => {
    setActiveSessionId(session.id);
    applySessionVisibility(session.generation, sessions.length);
    requestAnimationFrame(() => {
      scrollToActiveSession();
    });
  };

  // Sessões filtradas pela busca
  const filteredSessions = useMemo(() => {
    const list = filterSessions(sessions, messagesBySession, searchQuery);
    // Ordena da mais recente para a mais antiga na visualização
    return [...list].sort((a, b) => b.generation - a.generation);
  }, [sessions, messagesBySession, searchQuery]);

  // Verifica se o usuário está navegando em uma sessão de histórico anterior à mais recente
  const isViewingHistory = useMemo(() => {
    if (sessions.length <= 1) return false;
    const current = sessions.find((s) => s.id === activeSessionId);
    const latest = sessions[sessions.length - 1];
    return Boolean(current && latest && current.generation < latest.generation);
  }, [sessions, activeSessionId]);

  // Ação de criar Nova Sessão
  const handleNewSession = async () => {
    if (!issueId) {
      const composer = document.querySelector<HTMLElement>(
        "[data-testid='task-chat-composer-input'] div[contenteditable='true'], #main-content textarea",
      );
      if (composer) composer.focus();
      return;
    }
    setLoading(true);
    try {
      const ok = await sendNewSessionCommand(issueId, companyId || undefined);
      if (ok) {
        await new Promise((r) => setTimeout(r, 400));
        await refreshChatData(true);
        setTimeout(() => {
          const composer = document.querySelector<HTMLElement>(
            "[data-testid='task-chat-composer-input'] div[contenteditable='true'], #main-content textarea",
          );
          if (composer) composer.focus();
        }, 100);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRename = (session: ChatSession, newTitle: string) => {
    if (!companyId || !routeInfo.agentRef) return;
    saveCustomTitle(companyId, routeInfo.agentRef, session.id, newTitle);
    refreshChatData(true);
  };

  // Redimensionamento lateral
  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startWidth: width,
      pointerId: e.pointerId,
    };
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragRef.current) return;
    const deltaX = e.clientX - dragRef.current.startX;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + deltaX));
    setWidth(newWidth);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(newWidth));
    } catch {}
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(dragRef.current.pointerId);
      } catch {}
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  if (!container || !moduleEnabled || !routeInfo.isChat) {
    return null;
  }

  const content = collapsed ? (
    <aside
      style={{ order: -1 }}
      className="w-10 shrink-0 border-r border-border/80 bg-background/95 flex flex-col items-center py-3 z-10"
    >
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title="Expandir lista de chats"
        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <PanelLeft className="w-4 h-4" />
      </button>
    </aside>
  ) : (
    <aside
      style={{ width: `${width}px`, order: -1 }}
      className="relative shrink-0 border-r border-border/80 bg-background/95 flex flex-col h-full min-h-0 select-none z-10"
    >
      {/* Cabeçalho da coluna de chats */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-xs tracking-tight text-foreground truncate">
            Sessões do Chat
          </span>
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground font-mono">
            {sessions.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => refreshChatData()}
            title="Atualizar conversas"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Recolher painel de chats"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Botão de Ação: + Nova Sessão */}
      <div className="p-2.5 shrink-0">
        <button
          type="button"
          onClick={handleNewSession}
          disabled={loading}
          className="w-full h-8 inline-flex items-center justify-center gap-1.5 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Nova Sessão</span>
        </button>
      </div>

      {/* Indicador de Histórico quando visualizando sessão anterior */}
      {isViewingHistory && (
        <div className="px-2.5 pb-2 shrink-0">
          <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-md bg-muted/60 border border-border/80 text-[11px] text-muted-foreground">
            <span className="truncate">Visualizando histórico</span>
            <button
              type="button"
              onClick={() => {
                const latest = sessions[sessions.length - 1];
                if (latest) handleSelectSession(latest);
              }}
              className="text-primary hover:underline font-medium shrink-0 cursor-pointer"
            >
              Ir para atual
            </button>
          </div>
        </div>
      )}

      {/* Input de Pesquisa dentro do Chat */}
      <div className="px-2.5 pb-2 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-muted-foreground/70 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar nos chats..."
            className="w-full h-7 pl-8 pr-7 text-xs bg-muted/40 hover:bg-muted/60 focus:bg-background rounded-md border border-border/60 outline-none text-foreground placeholder:text-muted-foreground/60 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 text-muted-foreground hover:text-foreground p-0.5"
              title="Limpar pesquisa"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Lista de Sessões */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 space-y-1 py-1">
        {filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center text-muted-foreground/80">
            <MessageSquareDashed className="w-8 h-8 mb-2 stroke-1 opacity-50" />
            <p className="text-xs">Nenhuma sessão encontrada</p>
          </div>
        ) : (
          filteredSessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={handleSelectSession}
              onRename={handleRename}
            />
          ))
        )}
      </div>

      {/* Resizer lateral na borda direita */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Redimensionar barra de chats"
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/40 active:bg-primary transition-colors z-20"
      />
    </aside>
  );

  return createPortal(content, container);
}
