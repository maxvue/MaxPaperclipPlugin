import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Bot,
  FileCode,
  Edit3,
  Clock,
  Wrench,
  Plus,
  X,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  PanelRightClose,
  PanelRight,
  RefreshCw,
  Download,
  CheckCircle2,
} from "lucide-react";
import type { RelatedTask, SubagentExecution, ArtifactItem, ExecutionMetrics, ScopeMode } from "./types.js";
import {
  extractMentionedIssueIdentifiers,
  parseSubagentInvocations,
  parseArtifacts,
  calculateExecutionMetrics,
} from "./parser.js";
import {
  fetchRelatedTasks,
  fetchIssueDocumentsAndAttachments,
  createNewLinkedTask,
} from "./api.js";
import {
  parseChatRoute,
  fetchAgentChatContext,
  findChatLayoutContainer,
} from "../chat-sessions/engine.js";
import {
  groupCommentsIntoSessions,
  activeChatSessionStore,
  type RawIssueComment,
} from "../chat-sessions/store.js";
import { StatusIcon } from "../tasks/StatusIcon.js";
import { useSidebarStore } from "../tasks/store.js";
import { getSettings, subscribeSettings } from "../../config/settings.js";

const CONTEXT_WIDTH_KEY = "max:chat-context:sidebar-width";
const CONTEXT_COLLAPSED_KEY = "max:chat-context:collapsed";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 270;
const MAX_WIDTH = 480;

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(CONTEXT_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
      return parsed;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONTEXT_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "< 1m";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const remSecs = seconds % 60;
  if (mins < 60) {
    return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export function AgentChatContextSidebar() {
  const [moduleEnabled, setModuleEnabled] = useState(() => getSettings().chatSessions);
  const [routeInfo, setRouteInfo] = useState(() => parseChatRoute());
  const [container, setContainer] = useState<HTMLElement | null>(findChatLayoutContainer);

  const [width, setWidth] = useState(readStoredWidth);
  const [isWideScreen, setIsWideScreen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1200 : true,
  );
  const [userCollapsed, setUserCollapsed] = useState(readStoredCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false); // Para telas < 1200px
  const [scope, setScope] = useState<ScopeMode>("session");

  // Dados do chat
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [rawComments, setRawComments] = useState<RawIssueComment[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => activeChatSessionStore.get());
  const [loading, setLoading] = useState(false);

  // Documentos e anexos da issue
  const [issueDocs, setIssueDocs] = useState<any[]>([]);
  const [issueAttachments, setIssueAttachments] = useState<any[]>([]);

  // Tarefas relacionadas
  const [relatedTasks, setRelatedTasks] = useState<RelatedTask[]>([]);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [metricsExpanded, setMetricsExpanded] = useState(true);
  const [artifactsExpanded, setArtifactsExpanded] = useState(true);
  const [subagentsExpanded, setSubagentsExpanded] = useState(true);

  // Formulário rápido de criação de tarefa vinculada
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creatingTaskLoading, setCreatingTaskLoading] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);

  // Monitora estado do painel de Tarefas & Execuções para ajustar ordenação no flexbox:
  // Se Tarefas & Execuções estiver aberto à direita, o painel de contexto deve aparecer à sua esquerda (order 90 vs 100).
  const { isOpen: isTaskSidebarOpen, side: taskSidebarSide } = useSidebarStore();
  const isTaskSidebarOnRight = isTaskSidebarOpen && taskSidebarSide === "right";
  const flexOrder = isTaskSidebarOnRight ? 90 : 100;

  // Monitora container DOM
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

  // Monitora largura da janela para responsividade (>= 1200px)
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== "undefined") {
        setIsWideScreen(window.innerWidth >= 1200);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Monitora configurações do plugin
  useEffect(() => {
    return subscribeSettings((s) => {
      setModuleEnabled(s.chatSessions);
    });
  }, []);

  // Monitora alterações na URL
  useEffect(() => {
    const handleUrlChange = () => {
      const current = parseChatRoute();
      setRouteInfo(current);
    };

    window.addEventListener("popstate", handleUrlChange);
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

  // Sincroniza sessão ativa selecionada na coluna esquerda
  useEffect(() => {
    return activeChatSessionStore.subscribe((newSessionId) => {
      setActiveSessionId(newSessionId);
    });
  }, []);

  // Busca dados do chat e da issue
  const loadChatData = useCallback(async () => {
    if (!routeInfo.isChat || !routeInfo.companyPrefix || !routeInfo.agentRef) return;
    setLoading(true);

    try {
      const ctx = await fetchAgentChatContext(routeInfo.companyPrefix, routeInfo.agentRef);
      if (ctx) {
        setCompanyId(ctx.companyId);
        setIssueId(ctx.issueId);
        setRawComments(ctx.comments);

        if (ctx.issueId) {
          const { documents, attachments } = await fetchIssueDocumentsAndAttachments(ctx.issueId);
          setIssueDocs(documents);
          setIssueAttachments(attachments);
        }
      }
    } catch (err) {
      console.warn("[MaxPaperclipPlugin] Erro ao carregar dados de contexto de chat:", err);
    } finally {
      setLoading(false);
    }
  }, [routeInfo]);

  useEffect(() => {
    loadChatData();
    const interval = setInterval(() => {
      loadChatData();
    }, 6000);
    return () => clearInterval(interval);
  }, [loadChatData]);

  // Comentários filtrados pelo escopo (Sessão Atual vs Geral do Agente)
  const scopedComments = useMemo(() => {
    if (!companyId || !routeInfo.agentRef || !issueId || rawComments.length === 0) {
      return [];
    }

    if (scope === "agent" || !activeSessionId) {
      return rawComments;
    }

    const { messagesBySession } = groupCommentsIntoSessions(
      companyId,
      routeInfo.agentRef,
      issueId,
      rawComments,
    );

    const sessionMessages = messagesBySession.get(activeSessionId) || [];
    const messageIdSet = new Set(sessionMessages.map((m) => m.id));

    return rawComments.filter((c) => messageIdSet.has(c.id));
  }, [companyId, routeInfo.agentRef, issueId, rawComments, scope, activeSessionId]);

  // Subagentes
  const subagents: SubagentExecution[] = useMemo(() => {
    return parseSubagentInvocations(scopedComments);
  }, [scopedComments]);

  // Artefatos
  const artifacts: ArtifactItem[] = useMemo(() => {
    return parseArtifacts(scopedComments, issueDocs, issueAttachments);
  }, [scopedComments, issueDocs, issueAttachments]);

  // Métricas
  const metrics: ExecutionMetrics = useMemo(() => {
    const base = calculateExecutionMetrics(scopedComments);
    return {
      ...base,
      totalSubagents: subagents.length,
      totalArtifacts: artifacts.length,
    };
  }, [scopedComments, subagents.length, artifacts.length]);

  // Identificadores de tarefas mencionados
  const mentionedIdentifiers = useMemo(() => {
    const textCorpus = scopedComments.map((c) => c.body || "").join("\n");
    return extractMentionedIssueIdentifiers(textCorpus);
  }, [scopedComments]);

  // Busca tarefas relacionadas sempre que os identificadores ou a issue mudarem
  useEffect(() => {
    if (!companyId || !issueId) return;

    fetchRelatedTasks(companyId, issueId, mentionedIdentifiers).then((tasks) => {
      setRelatedTasks(tasks);
    });
  }, [companyId, issueId, mentionedIdentifiers]);

  // Ação de criação de tarefa vinculada
  const handleCreateLinkedTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !companyId || !issueId) return;

    setCreatingTaskLoading(true);
    try {
      const created = await createNewLinkedTask(companyId, issueId, newTaskTitle.trim());
      if (created) {
        setNewTaskTitle("");
        setIsCreatingTask(false);
        // Atualiza a lista de tarefas
        const updated = await fetchRelatedTasks(companyId, issueId, mentionedIdentifiers);
        setRelatedTasks(updated);
      }
    } finally {
      setCreatingTaskLoading(false);
    }
  };

  // Redimensionamento da coluna
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
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
    // Barra à direita: arrastar para a esquerda aumenta a largura
    const deltaX = dragRef.current.startX - e.clientX;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + deltaX));
    setWidth(newWidth);
    try {
      window.localStorage.setItem(CONTEXT_WIDTH_KEY, String(newWidth));
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

  const toggleCollapsed = () => {
    const next = !userCollapsed;
    setUserCollapsed(next);
    try {
      window.localStorage.setItem(CONTEXT_COLLAPSED_KEY, String(next));
    } catch {}
  };

  if (!container || !moduleEnabled || !routeInfo.isChat) {
    return null;
  }

  // Se não estiver em tela ampla e a gaveta não estiver aberta, exibe o botão flutuante discreto no topo
  const shouldRenderAsDrawer = !isWideScreen;
  const isVisible = shouldRenderAsDrawer ? drawerOpen : !userCollapsed;

  const content = (
    <div className="flex flex-col h-full w-full overflow-hidden select-text text-foreground">
      {/* Cabeçalho do Painel de Contexto */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-card/90 backdrop-blur-xs shrink-0 select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground truncate">
            Contexto & Execução
          </h3>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => loadChatData()}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
            title="Atualizar dados"
            aria-label="Atualizar dados"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
          </button>

          {shouldRenderAsDrawer ? (
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
              title="Fechar painel"
              aria-label="Fechar painel"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
              title="Recolher painel de contexto"
              aria-label="Recolher painel de contexto"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Seletor de Escopo (Sessão Atual vs Geral do Agente) */}
      <div className="px-2.5 py-1.5 border-b border-border/40 bg-muted/20 flex items-center justify-between shrink-0">
        <span className="text-[10.5px] font-medium text-muted-foreground">Escopo:</span>
        <div className="inline-flex rounded-md p-0.5 bg-background border border-border/70 text-[10.5px] font-medium">
          <button
            type="button"
            onClick={() => setScope("session")}
            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
              scope === "session"
                ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Exibir dados da sessão ativa selecionada"
          >
            Sessão Atual
          </button>
          <button
            type="button"
            onClick={() => setScope("agent")}
            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
              scope === "agent"
                ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Exibir dados consolidados de todas as sessões do agente"
          >
            Geral
          </button>
        </div>
      </div>

      {/* Corpo com Scroll Independente */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3.5 [scrollbar-gutter:stable]">
        {/* Seção 1: Mini-Cards de Métricas de Execução */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setMetricsExpanded(!metricsExpanded)}
            className="flex items-center justify-between w-full px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
          >
            <span>Métricas de Execução</span>
            {metricsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {metricsExpanded && (
            <div className="grid grid-cols-2 gap-1.5">
              {/* Subagentes */}
              <div className="flex items-center gap-2 p-2 rounded-md bg-card/60 border border-border/50">
                <div className="p-1 rounded bg-blue-500/15 text-blue-500 shrink-0">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground font-medium">Subagentes</div>
                  <div className="text-xs font-mono font-bold text-foreground">{metrics.totalSubagents}</div>
                </div>
              </div>

              {/* Artefatos */}
              <div className="flex items-center gap-2 p-2 rounded-md bg-card/60 border border-border/50">
                <div className="p-1 rounded bg-purple-500/15 text-purple-500 shrink-0">
                  <FileCode className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground font-medium">Artefatos</div>
                  <div className="text-xs font-mono font-bold text-foreground">{metrics.totalArtifacts}</div>
                </div>
              </div>

              {/* Edições */}
              <div className="flex items-center gap-2 p-2 rounded-md bg-card/60 border border-border/50">
                <div className="p-1 rounded bg-amber-500/15 text-amber-500 shrink-0">
                  <Edit3 className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground font-medium">Edições</div>
                  <div className="text-xs font-mono font-bold text-foreground">{metrics.totalEdits}</div>
                </div>
              </div>

              {/* Duração */}
              <div className="flex items-center gap-2 p-2 rounded-md bg-card/60 border border-border/50">
                <div className="p-1 rounded bg-emerald-500/15 text-emerald-500 shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground font-medium">Duração</div>
                  <div className="text-xs font-mono font-bold text-foreground">{formatDuration(metrics.durationSeconds)}</div>
                </div>
              </div>

              {/* Ferramentas */}
              <div className="col-span-2 flex items-center justify-between p-2 rounded-md bg-card/60 border border-border/50">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1 rounded bg-rose-500/15 text-rose-500 shrink-0">
                    <Wrench className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium truncate">Ferramentas & Comandos</span>
                </div>
                <span className="text-xs font-mono font-bold text-foreground">{metrics.toolsCount}</span>
              </div>
            </div>
          )}
        </div>

        {/* Seção 2: Tarefas Relacionadas */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => setTasksExpanded(!tasksExpanded)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
            >
              {tasksExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <span>Tarefas Relacionadas ({relatedTasks.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCreatingTask(!isCreatingTask)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
              title="Criar nova tarefa vinculada à conversa"
            >
              <Plus className="w-3 h-3" />
              <span>Nova</span>
            </button>
          </div>

          {/* Formulário rápido de criação de tarefa */}
          {isCreatingTask && (
            <form onSubmit={handleCreateLinkedTask} className="p-2 rounded-md bg-muted/30 border border-primary/30 flex flex-col gap-1.5">
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="Título da tarefa vinculada..."
                autoFocus
                className="w-full px-2 py-1 text-xs rounded bg-background border border-border focus:outline-hidden focus:border-primary text-foreground"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsCreatingTask(false)}
                  className="px-2 py-0.5 text-[10.5px] rounded text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newTaskTitle.trim() || creatingTaskLoading}
                  className="px-2.5 py-0.5 text-[10.5px] font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                >
                  {creatingTaskLoading ? "Criando..." : "Criar Tarefa"}
                </button>
              </div>
            </form>
          )}

          {tasksExpanded && (
            <div className="flex flex-col gap-1">
              {relatedTasks.length > 0 ? (
                relatedTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md bg-card/60 hover:bg-accent/40 border border-border/40 transition-colors select-none text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <StatusIcon status={t.status} size="12px" />
                      {t.identifier && (
                        <a
                          href={`/${routeInfo.companyPrefix}/issues/${t.identifier || t.id}`}
                          className="font-mono text-[11px] font-semibold text-primary hover:underline shrink-0"
                          title={`Abrir ${t.identifier}`}
                        >
                          {t.identifier}
                        </a>
                      )}
                      <span className="truncate text-foreground/80 font-medium" title={t.title}>
                        {t.title}
                      </span>
                    </div>

                    {/* Badge do tipo de relação */}
                    <span
                      className={`shrink-0 px-1 py-0.2 rounded text-[9px] font-medium border ${
                        t.relationType === "created_from"
                          ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                          : t.relationType === "child"
                          ? "bg-blue-500/15 text-blue-500 border-blue-500/30"
                          : "bg-purple-500/15 text-purple-500 border-purple-500/30"
                      }`}
                      title={
                        t.relationType === "created_from"
                          ? "Tarefa criada a partir desta conversa"
                          : t.relationType === "child"
                          ? "Subtarefa vinculada"
                          : "Mencionada no chat"
                      }
                    >
                      {t.relationType === "created_from"
                        ? "Criada"
                        : t.relationType === "child"
                        ? "Filha"
                        : "Citada"}
                    </span>
                  </div>
                ))
              ) : (
                <div className="py-2 px-1 text-[11px] text-muted-foreground/60 italic text-center">
                  Nenhuma tarefa vinculada a esta {scope === "session" ? "sessão" : "conversa"}.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Seção 3: Subagentes Utilizados */}
        {subagents.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => setSubagentsExpanded(!subagentsExpanded)}
              className="flex items-center justify-between w-full px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
            >
              <span>Subagentes Invocados ({subagents.length})</span>
              {subagentsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {subagentsExpanded && (
              <div className="flex flex-col gap-1">
                {subagents.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between px-2 py-1.5 rounded-md bg-card/60 border border-border/40 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <Bot className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="truncate font-medium text-foreground/80" title={sub.role || sub.name}>
                        {sub.name}
                      </span>
                    </div>

                    <span className="shrink-0 flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Concluído</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Seção 4: Artefatos Produzidos */}
        {artifacts.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => setArtifactsExpanded(!artifactsExpanded)}
              className="flex items-center justify-between w-full px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
            >
              <span>Artefatos Produzidos ({artifacts.length})</span>
              {artifactsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {artifactsExpanded && (
              <div className="flex flex-col gap-1">
                {artifacts.map((art) => (
                  <div
                    key={art.id}
                    className="flex items-center justify-between px-2 py-1.5 rounded-md bg-card/60 border border-border/40 text-xs hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <FileCode className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span className="truncate font-medium text-foreground/80" title={art.name}>
                        {art.name}
                      </span>
                    </div>

                    {art.downloadUrl && (
                      <a
                        href={art.downloadUrl}
                        download
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors shrink-0"
                        title="Baixar artefato"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // 1. Telas compactas (< 1200px): Botão flutuante ou gaveta (drawer)
  if (shouldRenderAsDrawer) {
    return createPortal(
      <>
        {/* Botão de Atalho Flutuante para abrir o contexto */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="fixed top-3 right-4 z-40 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold bg-card/90 border border-border shadow-lg hover:bg-accent text-foreground backdrop-blur-xs transition-transform active:scale-95 cursor-pointer"
          title="Abrir Contexto & Execução da Conversa"
        >
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span>Contexto</span>
          {(relatedTasks.length > 0 || metrics.totalSubagents > 0) && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-primary text-primary-foreground">
              {relatedTasks.length + metrics.totalSubagents}
            </span>
          )}
        </button>

        {/* Drawer Slide-over */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-2xs transition-opacity"
              onClick={() => setDrawerOpen(false)}
            />
            <div
              className="relative w-full max-w-[340px] h-full bg-card border-l border-border shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200"
            >
              {content}
            </div>
          </div>
        )}
      </>,
      document.body,
    );
  }

  // 2. Telas amplas (>= 1200px):
  // Se estiver recolhido manualmente pelo usuário, renderiza pequeno botão de expansão
  if (userCollapsed) {
    return createPortal(
      <div
        className="shrink-0 flex items-center justify-center p-1.5 border-l border-border bg-card/50"
        style={{ order: flexOrder }}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
          title="Expandir painel de Contexto & Execução"
        >
          <PanelRight className="w-4 h-4 text-primary" />
        </button>
      </div>,
      container,
    );
  }

  // Painel aberto normal na coluna direita
  return createPortal(
    <aside
      className="relative shrink-0 flex flex-col bg-card border-l border-border transition-[width] duration-150 ease-out h-full select-none"
      style={{
        width,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
        order: flexOrder,
      }}
    >
      {/* Alça de redimensionamento na borda esquerda */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="group absolute -left-1 inset-y-0 w-2 cursor-col-resize z-20 flex items-center justify-center select-none touch-none"
        title="Arraste para redimensionar"
      >
        <div
          className={`w-0.5 h-full transition-colors ${
            isDragging ? "bg-primary w-1" : "bg-transparent group-hover:bg-primary/50"
          }`}
        />
      </div>

      {content}
    </aside>,
    container,
  );
}
