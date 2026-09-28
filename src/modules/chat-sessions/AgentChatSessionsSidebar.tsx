import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, Search, X, PanelLeftClose, PanelLeft, RefreshCw, MessageSquareDashed, Archive } from "lucide-react";
import type { ChatSession } from "./types.js";
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
  archiveSession,
  unarchiveSession,
  deleteSessionPermanently,
  activeChatSessionStore,
  type RawIssueComment,
} from "./store.js";
import { SessionItem } from "./SessionItem.js";
import { SessionDeleteConfirmModal } from "./SessionDeleteConfirmModal.js";
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

  // Estados de Arquivamento e Remoção
  const [viewingArchived, setViewingArchived] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
    setViewingArchived(false);
    setSessionToDelete(null);
  }, [routeInfo.agentRef, routeInfo.companyPrefix]);

  // Sincroniza sessão ativa no store global compartilhado
  useEffect(() => {
    activeChatSessionStore.set(activeSessionId);
  }, [activeSessionId]);

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
        isArchived: false,
        isDeleted: false,
      };
      return {
        sessions: [initialSession],
        messagesBySession: new Map([["session-gen-0", []]]),
      };
    }

    return groupCommentsIntoSessions(companyId, routeInfo.agentRef, issueId, rawComments);
  }, [companyId, routeInfo.agentRef, issueId, rawComments]);

  // Contagens
  const activeSessionsCount = useMemo(() => sessions.filter((s) => !s.isArchived).length, [sessions]);
  const archivedSessionsCount = useMemo(() => sessions.filter((s) => s.isArchived).length, [sessions]);

  // Define a sessão ativa inicial se ainda não selecionada
  useEffect(() => {
    if (sessions.length > 0) {
      // Prioriza sessões ativas (não arquivadas)
      const activeSessions = sessions.filter((s) => !s.isArchived);
      const targetPool = activeSessions.length > 0 ? activeSessions : sessions;

      if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
        const lastSession = targetPool[targetPool.length - 1];
        if (lastSession) {
          setActiveSessionId(lastSession.id);
        }
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

  // Sessões filtradas pela busca e pelo modo arquivados
  const filteredSessions = useMemo(() => {
    const list = filterSessions(sessions, messagesBySession, searchQuery, viewingArchived);
    // Ordena da mais recente para a mais antiga na visualização
    return [...list].sort((a, b) => b.generation - a.generation);
  }, [sessions, messagesBySession, searchQuery, viewingArchived]);

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

  // Ação de Arquivar Conversa
  const handleArchive = (session: ChatSession) => {
    if (!companyId || !routeInfo.agentRef) return;
    archiveSession(companyId, routeInfo.agentRef, session.id);

    // Se a sessão arquivada for a ativa, seleciona a sessão ativa mais recente que restar
    if (session.id === activeSessionId) {
      const remainingActive = sessions.filter((s) => s.id !== session.id && !s.isArchived);
      if (remainingActive.length > 0) {
        const next = remainingActive[remainingActive.length - 1];
        handleSelectSession(next);
      }
    }

    refreshChatData(true);
  };

  // Ação de Desarquivar Conversa
  const handleUnarchive = (session: ChatSession) => {
    if (!companyId || !routeInfo.agentRef) return;
    unarchiveSession(companyId, routeInfo.agentRef, session.id);
    refreshChatData(true);
  };

  // Ação de Solicitar Exclusão Permanente (Abre modal)
  const handleRequestDelete = (session: ChatSession) => {
    setSessionToDelete(session);
  };

  // Ação de Confirmar Exclusão Permanente
  const handleConfirmDelete = async () => {
    if (!sessionToDelete || !companyId || !routeInfo.agentRef) return;
    setIsDeleting(true);

    try {
      const deletedId = sessionToDelete.id;
      deleteSessionPermanently(companyId, routeInfo.agentRef, deletedId);

      // Se a sessão excluída for a ativa, seleciona a mais recente restante
      if (deletedId === activeSessionId) {
        const remaining = sessions.filter((s) => s.id !== deletedId && !s.isArchived);
        if (remaining.length > 0) {
          const next = remaining[remaining.length - 1];
          handleSelectSession(next);
        } else {
          setActiveSessionId(null);
        }
      }

      setSessionToDelete(null);
      await refreshChatData(true);
    } finally {
      setIsDeleting(false);
    }
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
        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
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
            {viewingArchived ? archivedSessionsCount : activeSessionsCount}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => refreshChatData()}
            title="Atualizar conversas"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Recolher painel de chats"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
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
      {isViewingHistory && !viewingArchived && (
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

      {/* Faixa de Modo Arquivados */}
      {viewingArchived && (
        <div className="px-2.5 pb-2 shrink-0">
          <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-600 dark:text-amber-400">
            <span className="font-medium">Modo Arquivados ({archivedSessionsCount})</span>
            <button
              type="button"
              onClick={() => setViewingArchived(false)}
              className="hover:underline font-semibold cursor-pointer"
            >
              Voltar às ativas
            </button>
          </div>
        </div>
      )}

      {/* Barra de Pesquisa + Botão de Arquivados no Topo */}
      <div className="px-2.5 pb-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 flex items-center">
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
                className="absolute right-2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                title="Limpar pesquisa"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Botão de Alternar Modo Arquivados */}
          <button
            type="button"
            onClick={() => setViewingArchived(!viewingArchived)}
            className={`h-7 px-2 flex items-center justify-center rounded-md border text-xs transition-colors cursor-pointer shrink-0 ${
              viewingArchived
                ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40 font-semibold shadow-2xs"
                : "bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground border-border/60"
            }`}
            title={viewingArchived ? "Exibir conversas ativas" : "Exibir conversas arquivadas"}
            aria-label={viewingArchived ? "Exibir conversas ativas" : "Exibir conversas arquivadas"}
          >
            <Archive className="w-3.5 h-3.5" />
            {archivedSessionsCount > 0 && !viewingArchived && (
              <span className="ml-1 text-[10px] font-mono opacity-80">{archivedSessionsCount}</span>
            )}
          </button>
        </div>
      </div>

      {/* Lista de Sessões */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 space-y-1 py-1">
        {filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center text-muted-foreground/80">
            <MessageSquareDashed className="w-8 h-8 mb-2 stroke-1 opacity-50" />
            <p className="text-xs">
              {viewingArchived ? "Nenhuma conversa arquivada" : "Nenhuma conversa encontrada"}
            </p>
          </div>
        ) : (
          filteredSessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              isArchivedView={viewingArchived}
              onSelect={handleSelectSession}
              onRename={handleRename}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onDelete={handleRequestDelete}
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

      {/* Modal de Confirmação para Remoção Definitiva */}
      <SessionDeleteConfirmModal
        isOpen={Boolean(sessionToDelete)}
        session={sessionToDelete}
        loading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setSessionToDelete(null)}
      />
    </aside>
  );

  return createPortal(content, container);
}
