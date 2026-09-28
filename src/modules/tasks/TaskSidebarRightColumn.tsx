import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ListTodo, Search, RefreshCw, X, CheckCircle, PanelLeft, PanelRight, Plus } from "lucide-react";
import type { IssueSummary, LiveRun, ProjectSummary } from "./types.js";
import { fetchCompanyTasks, fetchCompanyProjects, fetchCompanyLiveRuns } from "./api.js";
import { sidebarStore, useSidebarStore } from "./store.js";
import { TaskCard } from "./TaskCard.js";

interface TaskSidebarRightColumnProps {
  context?: {
    companyId?: string | null;
    companyPrefix?: string | null;
  };
}

const WIDTH_STORAGE_KEY = "paperclip:plugin-task-sidebar:width";
const DEFAULT_WIDTH = 350;
const MIN_WIDTH = 260;

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_WIDTH) {
      return parsed;
    }
  } catch {
    // Ignora erro
  }
  return DEFAULT_WIDTH;
}

export function TaskSidebarRightColumn({ context }: TaskSidebarRightColumnProps) {
  const { isOpen, side } = useSidebarStore();
  const companyId = context?.companyId;
  const companyPrefix = context?.companyPrefix;

  const [width, setWidth] = useState(readStoredWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);

  const [tasks, setTasks] = useState<IssueSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [liveRuns, setLiveRuns] = useState<LiveRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  const refreshData = async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);

    try {
      const [fetchedTasks, fetchedProjects, fetchedLiveRuns] = await Promise.all([
        fetchCompanyTasks(companyId),
        fetchCompanyProjects(companyId),
        fetchCompanyLiveRuns(companyId),
      ]);

      setTasks(fetchedTasks);
      setProjects(fetchedProjects);
      setLiveRuns(fetchedLiveRuns);
    } catch (err) {
      console.warn("Erro ao atualizar dados do TaskSidebar:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!companyId) return;
    refreshData();
    const interval = setInterval(() => {
      refreshData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [companyId]);

  const handleNewTask = useCallback(() => {
    if (typeof document === "undefined") return;

    // 1. Tenta acionar o botão nativo "New Task" no Sidebar do Paperclip
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    const newIssueBtn = buttons.find((b) => {
      const aria = b.getAttribute("aria-label")?.toLowerCase();
      const text = b.textContent?.trim().toLowerCase();
      return (
        aria === "new task" ||
        aria === "new issue" ||
        text === "new task" ||
        text === "new issue" ||
        text === "nova tarefa"
      );
    });

    if (newIssueBtn) {
      newIssueBtn.click();
      return;
    }

    // 2. Dispara atalho de teclado global "c" que abre o NewIssueDialog no Paperclip
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
      activeEl.blur();
    }
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "c",
        code: "KeyC",
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);

  const widthRef = useRef(width);
  widthRef.current = width;

  // Controles de redimensionamento por arrasto sem largura máxima (alteração livre)
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    dragRef.current = {
      startX: e.clientX,
      startWidth: widthRef.current,
      pointerId: e.pointerId,
    };
    setIsDragging(true);
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    // Se o painel estiver na ESQUERDA: mover para a direita aumenta a largura
    // Se o painel estiver na DIREITA: mover para a esquerda aumenta a largura
    const delta = side === "left"
      ? e.clientX - dragRef.current.startX
      : dragRef.current.startX - e.clientX;
    const newWidth = Math.max(dragRef.current.startWidth + delta, MIN_WIDTH);
    setWidth(newWidth);
  }, [side]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "";
    }
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
    } catch {
      // Ignora erro
    }
  }, []);

  const handleLostPointerCapture = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "";
    }
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
    } catch {
      // Ignora erro
    }
  }, []);

  // Mapa de projetos por ID
  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectSummary>();
    for (const proj of projects) {
      map.set(proj.id, proj);
    }
    return map;
  }, [projects]);

  // IDs de tarefas com execuções ativas
  const activeRunTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const run of liveRuns) {
      if (run.status === "running") {
        const snap = run.contextSnapshot as { issueId?: string } | undefined;
        if (snap?.issueId) {
          set.add(snap.issueId);
        }
      }
    }
    return set;
  }, [liveRuns]);

  // Agrupamento de subtarefas por parentId
  const { rootTasks, subtasksByParent } = useMemo(() => {
    const roots: IssueSummary[] = [];
    const subMap = new Map<string, IssueSummary[]>();

    for (const task of tasks) {
      if (task.parentId) {
        const existing = subMap.get(task.parentId) || [];
        existing.push(task);
        subMap.set(task.parentId, existing);
      } else {
        roots.push(task);
      }
    }

    return { rootTasks: roots, subtasksByParent: subMap };
  }, [tasks]);

  // Filtragem por busca
  const filteredTasks = useMemo(() => {
    if (!searchFilter.trim()) return rootTasks;
    const q = searchFilter.toLowerCase().trim();

    return rootTasks.filter((task) => {
      const titleMatch = task.title.toLowerCase().includes(q);
      const identifierMatch = task.identifier?.toLowerCase().includes(q);
      const projName = task.projectId ? projectsById.get(task.projectId)?.name.toLowerCase() : "";
      const projMatch = projName?.includes(q);

      return titleMatch || identifierMatch || projMatch;
    });
  }, [rootTasks, searchFilter, projectsById]);

  const liveAgentsCount = liveRuns.filter((r) => r.status === "running").length;

  return (
    <aside
      id="task-sidebar-resizable-panel"
      className={`hidden md:flex bg-card flex-col ${
        side === "left" ? "border-r border-border" : "border-l border-border"
      } relative h-full shrink-0 select-text ${
        isOpen ? "overflow-visible" : "overflow-hidden pointer-events-none"
      } ${!isDragging ? "transition-[width,opacity] duration-200 ease-in-out" : ""}`}
      style={{
        width: isOpen ? width : 0,
        opacity: isOpen ? 1 : 0,
        order: side === "left" ? -1 : 99,
        borderLeftWidth: isOpen && side === "right" ? "1px" : "0px",
        borderRightWidth: isOpen && side === "left" ? "1px" : "0px",
      }}
    >
      {/* Alça de Redimensionamento por Arrasto (Grip na borda interna) */}
      {isOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar painel de tarefas"
          data-side={side}
          className="group absolute inset-y-0 z-20 cursor-col-resize touch-none select-none"
          style={
            side === "left"
              ? { right: -4, left: "auto", width: 8 }
              : { left: -4, right: "auto", width: 8 }
          }
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handleLostPointerCapture}
          title="Arraste para redimensionar livremente"
        >
          <div
            className={`mx-auto h-full w-0.5 transition-colors ${
              isDragging ? "bg-primary w-1" : "bg-transparent group-hover:bg-primary/50"
            }`}
          />
        </div>
      )}

      {/* Conteúdo Interno da Coluna com Largura Mínima Garantida */}
      <div
        className="flex flex-col h-full min-w-[260px] overflow-hidden"
        style={{ width }}
      >
        {/* Cabeçalho do Painel */}
        <div className="flex items-center justify-between px-3.5 py-3 border-b border-border bg-card/80 backdrop-blur-xs shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ListTodo className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground truncate">
                Tarefas & Execuções
              </h2>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{rootTasks.length} tarefas</span>
                {liveAgentsCount > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-500 font-medium flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {liveAgentsCount} agente(s) ativo(s)
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Botão Nova Tarefa */}
            <button
              type="button"
              onClick={handleNewTask}
              style={{ marginRight: 14 }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs cursor-pointer select-none"
              title="Nova Tarefa (C)"
              aria-label="Nova Tarefa"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="font-medium whitespace-nowrap">Nova Tarefa</span>
            </button>

            {/* Botão para mover painel entre esquerda e direita */}
            <button
              type="button"
              onClick={() => sidebarStore.toggleSide()}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
              title={side === "right" ? "Mover painel para a esquerda" : "Mover painel para a direita"}
              aria-label={side === "right" ? "Mover painel para a esquerda" : "Mover painel para a direita"}
            >
              {side === "right" ? (
                <PanelLeft className="w-3.5 h-3.5" />
              ) : (
                <PanelRight className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Atualizar tarefas */}
            <button
              type="button"
              onClick={() => refreshData()}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
              title="Atualizar tarefas"
              aria-label="Atualizar tarefas"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
            </button>

            {/* Recolher painel */}
            <button
              type="button"
              onClick={() => sidebarStore.setIsOpen(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
              title="Recolher painel"
              aria-label="Recolher painel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barra de Filtro Rápido */}
        <div className="px-3 py-2 border-b border-border/40 bg-muted/20 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filtrar por título ou projeto..."
              className="w-full pl-8 pr-3 py-1 text-xs rounded-md bg-background border border-border/70 focus:outline-hidden focus:border-primary text-foreground placeholder:text-muted-foreground"
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Lista de Tarefas com Scroll Independente */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5 [scrollbar-gutter:stable]">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                subtasks={subtasksByParent.get(task.id) || []}
                project={task.projectId ? projectsById.get(task.projectId) : null}
                companyPrefix={companyPrefix}
                hasActiveLiveRun={activeRunTaskIds.has(task.id) || task.status === "in_progress"}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-muted-foreground">
              {loading ? (
                <>
                  <RefreshCw className="w-6 h-6 animate-spin text-primary mb-2 opacity-80" />
                  <p className="text-xs">Carregando tarefas da empresa...</p>
                </>
              ) : searchFilter ? (
                <>
                  <Search className="w-6 h-6 mb-2 opacity-50" />
                  <p className="text-xs font-medium">Nenhuma tarefa encontrada</p>
                  <p className="text-[11px] opacity-70 mt-0.5">Tente outro termo de busca.</p>
                </>
              ) : (
                <>
                  <CheckCircle className="w-6 h-6 mb-2 opacity-50" />
                  <p className="text-xs font-medium">Tudo limpo por aqui</p>
                  <p className="text-[11px] opacity-70 mt-0.5">Nenhuma tarefa ativa cadastrada.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
