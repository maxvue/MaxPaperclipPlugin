import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  ListTodo,
  Search,
  RefreshCw,
  X,
  CheckCircle,
  PanelLeft,
  PanelRight,
  Plus,
  ChevronDown,
  ChevronRight,
  Folder,
  Eye,
  Trash2,
  ClipboardList,
  Settings2,
  Terminal,
} from "lucide-react";
import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { IssueSummary, LiveRun, PlanningBootstrap, ProjectSummary } from "./types.js";
import {
  fetchCompanyTasks,
  fetchCompanyProjects,
  fetchCompanyLiveRuns,
  fetchTaskStatuses,
  archiveIssue,
  unarchiveIssue,
  deleteIssue,
  deleteIssueCascade,
  executeProjectTask,
} from "./api.js";
import { sidebarStore, useSidebarStore } from "./store.js";
import { TaskRow, type RunningAgentInfo } from "./TaskRow.js";
import { StatusIcon } from "./StatusIcon.js";
import { TaskDeleteConfirmModal } from "./TaskDeleteConfirmModal.js";
import { PlanningDialog } from "./PlanningDialog.js";
import { TaskLogsModal } from "./TaskLogsModal.js";
import { extrairRaizDoProjeto } from "./tasksJson.js";

interface TaskSidebarRightColumnProps {
  context?: {
    companyId?: string | null;
    companyPrefix?: string | null;
  };
}

const WIDTH_STORAGE_KEY = "paperclip:plugin-task-sidebar:width";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;

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
  const {
    isOpen,
    side,
    hiddenTaskIds,
    collapsedProjectIds,
    hiddenProjectIds,
    projectsOrder,
    runDevStates,
    runBuildStates,
    exibindoArquivados,
  } = useSidebarStore();

  const companyId = context?.companyId;
  const companyPrefix = context?.companyPrefix;
  const activeCompanyRef = useRef(companyId);
  activeCompanyRef.current = companyId;

  const [width, setWidth] = useState(readStoredWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);

  const [tasks, setTasks] = useState<IssueSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [liveRuns, setLiveRuns] = useState<LiveRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [hiddenAccordionOpen, setHiddenAccordionOpen] = useState(false);
  const [planningTarget, setPlanningTarget] = useState<{
    project: ProjectSummary;
    task?: IssueSummary | null;
    configurationOnly?: boolean;
  } | null>(null);
  const planning = usePluginData<PlanningBootstrap>("planning-bootstrap", {
    companyId: companyId ?? "",
  });

  // Estado do modal de logs de tarefas
  const [logsModalTarget, setLogsModalTarget] = useState<{
    projectId: string;
    projectName: string;
    taskType: "dev" | "build";
  } | null>(null);

  // Estado do modal de confirmação de exclusão
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    task: IssueSummary | null;
    subtasks: IssueSummary[];
    loading: boolean;
  }>({
    isOpen: false,
    task: null,
    subtasks: [],
    loading: false,
  });

  const refreshData = useCallback(async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);

    try {
      const [fetchedTasks, fetchedProjects, fetchedLiveRuns, taskStatuses] = await Promise.all([
        fetchCompanyTasks(companyId, true),
        fetchCompanyProjects(companyId),
        fetchCompanyLiveRuns(companyId),
        fetchTaskStatuses(companyId),
      ]);

      if (activeCompanyRef.current !== companyId) return;

      setTasks(fetchedTasks);
      setProjects(fetchedProjects);
      setLiveRuns(fetchedLiveRuns);
      if (taskStatuses) {
        sidebarStore.setAllTaskStatuses(taskStatuses);
      }
    } catch (err) {
      console.warn("Erro ao atualizar dados do TaskSidebar:", err);
    } finally {
      if (!silent && activeCompanyRef.current === companyId) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (silent: boolean) => {
      await refreshData(silent);
      if (!cancelled) timer = setTimeout(() => void poll(true), 5000);
    };

    void poll(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [companyId, refreshData]);

  const handleNewTask = useCallback((_projectId?: string) => {
    if (typeof document === "undefined") return;

    // 1. Tenta acionar o botão nativo "New Task" no Sidebar do Paperclip
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    const newIssueBtn = buttons.find((b) => {
      const text = b.textContent?.toLowerCase() || "";
      const aria = b.getAttribute("aria-label")?.toLowerCase() || "";
      return (
        (text.includes("new issue") ||
          text.includes("new task") ||
          text.includes("nova tarefa") ||
          aria.includes("new issue") ||
          aria.includes("new task")) &&
        b.offsetParent !== null
      );
    });

    if (newIssueBtn) {
      newIssueBtn.click();
      return;
    }

    // 2. Dispara evento de teclado 'c'
    const event = new KeyboardEvent("keydown", {
      key: "c",
      code: "KeyC",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  }, []);

  const widthRef = useRef(width);
  widthRef.current = width;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    dragRef.current = {
      startX: e.clientX,
      startWidth: widthRef.current,
      pointerId: e.pointerId,
    };
    setIsDragging(true);

    if (typeof document !== "undefined") {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();

      const deltaX = e.clientX - dragRef.current.startX;
      const newWidth =
        side === "left"
          ? dragRef.current.startWidth + deltaX
          : dragRef.current.startWidth - deltaX;

      const maxWidth = typeof window !== "undefined" ? window.innerWidth * 0.75 : 800;
      const clamped = Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(newWidth)));
      setWidth(clamped);
    },
    [side],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    try {
      const target = e.currentTarget as HTMLElement;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignora erro
    }
    dragRef.current = null;
    setIsDragging(false);

    if (typeof document !== "undefined") {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
    } catch {
      // Ignora erro
    }
  }, []);

  const handleLostPointerCapture = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
    if (typeof document !== "undefined") {
      document.body.style.cursor = "";
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

  // Mapa de agentes executando por ID de tarefa
  const runningAgentsByTaskId = useMemo(() => {
    const map = new Map<string, RunningAgentInfo[]>();
    for (const run of liveRuns) {
      if (run.status === "running") {
        const snap = run.contextSnapshot as { issueId?: string } | undefined;
        if (snap?.issueId) {
          const list = map.get(snap.issueId) || [];
          list.push({
            id: run.agentId || run.id,
            name: run.agentName || "Agente",
            status: run.status,
          });
          map.set(snap.issueId, list);
        }
      }
    }
    return map;
  }, [liveRuns]);

  // Separação de tarefas ativas vs arquivadas
  const targetTasks = useMemo(() => {
    if (exibindoArquivados) {
      return tasks.filter((t) => Boolean(t.hiddenAt));
    }
    return tasks.filter((t) => !t.hiddenAt);
  }, [tasks, exibindoArquivados]);

  // Separação de tarefas raiz e mapeamento de subtarefas por parentId
  const { rootTasks, subtasksByParent } = useMemo(() => {
    const roots: IssueSummary[] = [];
    const subMap = new Map<string, IssueSummary[]>();

    for (const task of targetTasks) {
      if (task.parentId) {
        const existing = subMap.get(task.parentId) || [];
        existing.push(task);
        subMap.set(task.parentId, existing);
      } else {
        roots.push(task);
      }
    }

    return { rootTasks: roots, subtasksByParent: subMap };
  }, [targetTasks]);

  // Filtragem por busca
  const searchFilteredRoots = useMemo(() => {
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

  // Separação entre visíveis e ocultas (apenas tarefas ativas sofrem ocultação individual)
  const visibleRootTasks = useMemo(() => {
    if (exibindoArquivados) return searchFilteredRoots;
    return searchFilteredRoots.filter((t) => !hiddenTaskIds.has(t.id));
  }, [searchFilteredRoots, hiddenTaskIds, exibindoArquivados]);

  const hiddenRootTasks = useMemo(() => {
    if (exibindoArquivados) return [];
    return rootTasks.filter((t) => hiddenTaskIds.has(t.id));
  }, [rootTasks, hiddenTaskIds, exibindoArquivados]);

  // Agrupamento por Projetos
  const projectGroups = useMemo(() => {
    const groups: Array<{
      id: string;
      name: string;
      color?: string | null;
      tasks: IssueSummary[];
      isUnassigned?: boolean;
    }> = [];

    const tasksByProject = new Map<string, IssueSummary[]>();
    const unassigned: IssueSummary[] = [];

    for (const task of visibleRootTasks) {
      if (task.projectId && projectsById.has(task.projectId)) {
        const list = tasksByProject.get(task.projectId) || [];
        list.push(task);
        tasksByProject.set(task.projectId, list);
      } else {
        unassigned.push(task);
      }
    }

    // Filtra projetos que não estejam ocultos
    for (const proj of projects) {
      if (!hiddenProjectIds.has(proj.id)) {
        const projTasks = tasksByProject.get(proj.id) || [];
        if (!searchFilter.trim() || projTasks.length > 0) {
          groups.push({
            id: proj.id,
            name: proj.name,
            color: proj.color,
            tasks: projTasks,
          });
        }
      }
    }

    // Grupo de tarefas sem projeto
    if (unassigned.length > 0) {
      groups.push({
        id: "__unassigned__",
        name: "Sem Projeto / Geral",
        color: null,
        tasks: unassigned,
        isUnassigned: true,
      });
    }

    // Ordenação personalizada dos projetos conforme projectsOrder
    if (projectsOrder.length > 0) {
      groups.sort((a, b) => {
        const idxA = projectsOrder.indexOf(a.id);
        const idxB = projectsOrder.indexOf(b.id);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    }

    return groups;
  }, [visibleRootTasks, projects, projectsById, hiddenProjectIds, searchFilter, projectsOrder]);

  // Lista de projetos ocultos para a seção inferior "Itens Ocultos"
  const hiddenProjectsList = useMemo(() => {
    return projects.filter((p) => hiddenProjectIds.has(p.id));
  }, [projects, hiddenProjectIds]);

  const allProjectIds = useMemo(() => {
    return projects.map((p) => p.id);
  }, [projects]);

  const visibleProjectIds = useMemo(() => {
    return projectGroups.filter((g) => !g.isUnassigned).map((g) => g.id);
  }, [projectGroups]);

  // Ações de ocultar / restaurar tarefa
  const handleHideTask = useCallback((taskId: string) => {
    sidebarStore.hideTask(taskId);
  }, []);

  const handleUnhideTask = useCallback((taskId: string) => {
    sidebarStore.unhideTask(taskId);
  }, []);

  // Ações de ocultar / restaurar projeto
  const handleHideProject = useCallback((projectId: string) => {
    sidebarStore.hideProject(projectId);
  }, []);

  const handleUnhideProject = useCallback((projectId: string) => {
    sidebarStore.unhideProject(projectId);
  }, []);

  // Ação de arquivar
  const handleArchiveTask = useCallback(async (taskId: string) => {
    const success = await archiveIssue(taskId);
    if (success) {
      refreshData(true);
    }
  }, []);

  // Ação de desarquivar
  const handleUnarchiveTask = useCallback(async (taskId: string) => {
    const success = await unarchiveIssue(taskId);
    if (success) {
      refreshData(true);
    }
  }, []);

  // Ações de ordenação de projetos
  const podeSubir = useCallback(
    (projectId: string) => {
      return visibleProjectIds[0] !== projectId;
    },
    [visibleProjectIds],
  );

  const podeDescer = useCallback(
    (projectId: string) => {
      return visibleProjectIds[visibleProjectIds.length - 1] !== projectId;
    },
    [visibleProjectIds],
  );

  const handleMoveProject = useCallback(
    (projectId: string, direcao: -1 | 1) => {
      sidebarStore.moveProject(projectId, direcao, visibleProjectIds, allProjectIds);
    },
    [visibleProjectIds, allProjectIds],
  );

  // Execução de NPM RUN DEV e NPM RUN BUILD
  const handleToggleRunDev = useCallback(
    async (projectId: string) => {
      if (!companyId) return;
      const proj = projectsById.get(projectId);
      const rootDir = proj ? extrairRaizDoProjeto(proj) || undefined : undefined;
      const current = sidebarStore.getSnapshot().runDevStates[projectId] ?? "parado";
      sidebarStore.setRunDevStatus(projectId, current === "rodando" ? "parado" : "rodando");
      const result = await executeProjectTask(companyId, projectId, "dev", "toggle", {
        rootDir,
        projectName: proj?.name,
      });
      if (result?.status) {
        sidebarStore.setRunDevStatus(projectId, result.status);
      }
    },
    [companyId, projectsById],
  );

  const handleToggleRunBuild = useCallback(
    async (projectId: string) => {
      if (!companyId) return;
      const proj = projectsById.get(projectId);
      const rootDir = proj ? extrairRaizDoProjeto(proj) || undefined : undefined;
      const current = sidebarStore.getSnapshot().runBuildStates[projectId] ?? "parado";
      if (
        current !== "rodando" &&
        !window.confirm(
          "Esta ação executará a task RUN BUILD definida pelo projeto local. Execute apenas projetos e arquivos .vscode/tasks.json confiáveis. Deseja continuar?",
        )
      ) return;
      sidebarStore.setRunBuildStatus(projectId, current === "rodando" ? "parado" : "rodando");
      const result = await executeProjectTask(companyId, projectId, "build", "toggle", {
        rootDir,
        projectName: proj?.name,
      });
      if (result?.status) {
        sidebarStore.setRunBuildStatus(projectId, result.status);
      }
    },
    [companyId, projectsById],
  );

  // Abertura do modal de exclusão
  const handleRequestDelete = useCallback((task: IssueSummary, subtasks: IssueSummary[]) => {
    setDeleteModalState({
      isOpen: true,
      task,
      subtasks,
      loading: false,
    });
  }, []);

  // Confirmação de exclusão em cascata (todas as subtarefas + pai)
  const handleConfirmCascade = useCallback(async () => {
    if (!deleteModalState.task) return;
    setDeleteModalState((prev) => ({ ...prev, loading: true }));

    const childIds = deleteModalState.subtasks.map((s) => s.id);
    const success = await deleteIssueCascade(deleteModalState.task.id, childIds);

    if (success) {
      setDeleteModalState({ isOpen: false, task: null, subtasks: [], loading: false });
      refreshData(true);
    } else {
      setDeleteModalState((prev) => ({ ...prev, loading: false }));
    }
  }, [deleteModalState]);

  // Confirmação de exclusão simples (sem subtarefas)
  const handleConfirmSingle = useCallback(async () => {
    if (!deleteModalState.task) return;
    setDeleteModalState((prev) => ({ ...prev, loading: true }));

    const success = await deleteIssue(deleteModalState.task.id);

    if (success) {
      setDeleteModalState({ isOpen: false, task: null, subtasks: [], loading: false });
      refreshData(true);
    } else {
      setDeleteModalState((prev) => ({ ...prev, loading: false }));
    }
  }, [deleteModalState]);

  const handleCancelDelete = useCallback(() => {
    if (deleteModalState.loading) return;
    setDeleteModalState({ isOpen: false, task: null, subtasks: [], loading: false });
  }, [deleteModalState.loading]);

  const liveAgentsCount = liveRuns.filter((r) => r.status === "running").length;
  const totalHiddenCount = hiddenProjectsList.length + hiddenRootTasks.length;

  return (
    <>
      <style>{`
        @keyframes maxTaskSpin {
          to { transform: rotate(360deg); }
        }
        .botao-subir-projeto,
        .botao-descer-projeto,
        .botao-run-dev-projeto,
        .botao-build-projeto,
        .botao-ocultar-projeto,
        .botao-mostrar-projeto,
        .botao-arquivados-topo {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          padding: 2px;
          border: 1px solid transparent;
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          color: currentColor;
          opacity: 0.75;
          transition: opacity 0.15s, background-color 0.15s, color 0.15s;
        }
        .botao-subir-projeto:hover:not(:disabled),
        .botao-descer-projeto:hover:not(:disabled),
        .botao-ocultar-projeto:hover,
        .botao-mostrar-projeto:hover,
        .botao-arquivados-topo:hover {
          opacity: 1;
          background: rgba(128, 128, 128, 0.15);
        }
        .botao-subir-projeto:disabled,
        .botao-descer-projeto:disabled {
          opacity: 0.25;
          cursor: default;
        }
        .botao-run-dev-projeto,
        .botao-build-projeto {
          position: relative;
        }
        .botao-run-dev-projeto.status-task-rodando,
        .botao-build-projeto.status-task-rodando {
          color: #4caf50;
          opacity: 1;
        }
        .botao-run-dev-projeto.status-task-rodando::after {
          content: '';
          position: absolute;
          inset: -1px;
          border: 1.5px solid #4caf50;
          border-top-color: transparent;
          border-radius: 50%;
          animation: maxTaskSpin 0.8s linear infinite;
          pointer-events: none;
        }
        .botao-run-dev-projeto.status-task-parado,
        .botao-build-projeto.status-task-parado {
          color: #888888;
        }
        .botao-run-dev-projeto.status-task-erro,
        .botao-build-projeto.status-task-erro {
          color: #ef4444;
          opacity: 1;
        }
        .botao-logs-task-projeto {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          padding: 2px;
          border: 1px solid transparent;
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          color: currentColor;
          opacity: 0.65;
          transition: opacity 0.15s, background-color 0.15s, color 0.15s;
        }
        .botao-logs-task-projeto:hover {
          opacity: 1;
          background: rgba(128, 128, 128, 0.15);
          color: #3b82f6;
        }
        .botao-arquivados-ativo {
          color: #f59e0b !important;
          opacity: 1 !important;
          background: rgba(245, 158, 11, 0.12) !important;
        }
        .modo-arquivados-banner {
          background: rgba(245, 158, 11, 0.08);
          border-bottom: 1px solid rgba(245, 158, 11, 0.2);
        }
      `}</style>

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
          order: side === "left" ? -1 : 100,
          borderLeftWidth: isOpen && side === "right" ? "1px" : "0px",
          borderRightWidth: isOpen && side === "left" ? "1px" : "0px",
        }}
      >
        {/* Alça de Redimensionamento por Arrasto */}
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

        {/* Conteúdo Interno da Coluna */}
        <div
          className="flex flex-col h-full min-w-[280px] overflow-hidden"
          style={{ width }}
        >
          {/* Cabeçalho do Painel */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card/90 backdrop-blur-xs shrink-0 select-none">
            <div className="flex items-center gap-2 min-w-0">
              <ListTodo className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground truncate">
                    Tarefas & Execuções
                  </h2>
                  {exibindoArquivados && (
                    <span className="px-1.5 py-0.2 text-[9.5px] font-bold uppercase tracking-wider rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                      Arquivados
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>{visibleRootTasks.length} {exibindoArquivados ? "arquivada(s)" : "tarefas"}</span>
                  {!exibindoArquivados && liveAgentsCount > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-emerald-500 font-medium flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {liveAgentsCount} ativo(s)
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Botão Nova Tarefa (somente no modo ativo) */}
              {!exibindoArquivados && (
                <button
                  type="button"
                  onClick={() => handleNewTask()}
                  className="inline-flex items-center gap-1 px-2 py-1 mr-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs cursor-pointer select-none"
                  title="Nova Tarefa (C)"
                  aria-label="Nova Tarefa"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="font-medium whitespace-nowrap hidden sm:inline">Nova Tarefa</span>
                </button>
              )}

              {/* Botão para mover painel entre esquerda e direita */}
              <button
                type="button"
                onClick={() => sidebarStore.toggleSide()}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
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
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
                title="Atualizar tarefas"
                aria-label="Atualizar tarefas"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
              </button>

              {/* Recolher painel */}
              <button
                type="button"
                onClick={() => sidebarStore.setIsOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
                title="Recolher painel"
                aria-label="Recolher painel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Barra de Filtro Rápido com Botão "Arquivados" no Topo (Estilo MaxCode) */}
          <div className={`px-2.5 py-1.5 border-b border-border/40 shrink-0 ${exibindoArquivados ? "modo-arquivados-banner" : "bg-muted/20"}`}>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder={exibindoArquivados ? "Filtrar tarefas arquivadas..." : "Filtrar por título ou projeto..."}
                  className="w-full pl-8 pr-7 py-1 text-xs rounded-md bg-background border border-border/70 focus:outline-hidden focus:border-primary text-foreground placeholder:text-muted-foreground"
                />
                {searchFilter && (
                  <button
                    type="button"
                    onClick={() => setSearchFilter("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Botão de Arquivados no Topo (Requisito 8 — idêntico ao MaxCode) */}
              <button
                type="button"
                className={`botao-arquivados-topo p-1 text-xs ${exibindoArquivados ? "botao-arquivados-ativo" : "text-muted-foreground"}`}
                title={exibindoArquivados ? "Voltar para tarefas ativas" : "Ver tarefas arquivadas"}
                aria-label={exibindoArquivados ? "Voltar para tarefas ativas" : "Ver tarefas arquivadas"}
                onClick={() => sidebarStore.toggleExibindoArquivados()}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M0 0h24v24H0z" fill="none" />
                  <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                    <rect width="20" height="5" x="2" y="3" rx="1" />
                    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8m-10 4h4" />
                  </g>
                </svg>
              </button>
            </div>
          </div>

          {/* Lista de Projetos e Tarefas com Scroll Independente */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3.5 [scrollbar-gutter:stable]">
            {projectGroups.length > 0 ? (
              projectGroups.map((group) => {
                const isCollapsed = collapsedProjectIds.has(group.id);
                const activeCount = group.tasks.filter(
                  (t) => t.status !== "done" && t.status !== "completed" && t.status !== "cancelled",
                ).length;

                const runDevStatus = runDevStates[group.id] ?? "parado";
                const runBuildStatus = runBuildStates[group.id] ?? "parado";
                const canUp = podeSubir(group.id);
                const canDown = podeDescer(group.id);

                return (
                  <section
                    key={group.id}
                    className="flex flex-col gap-1 rounded-lg border border-border/50 bg-card/30 p-1.5 select-none"
                  >
                    {/* Cabeçalho do Grupo de Projeto (Estilo MaxCode com Ações Rápidas) */}
                    <header className="flex items-center justify-between px-1.5 py-1 rounded text-xs font-semibold text-foreground hover:bg-accent/30 transition-colors">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => sidebarStore.toggleProjectCollapsed(group.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            sidebarStore.toggleProjectCollapsed(group.id);
                          }
                        }}
                        className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
                        title={isCollapsed ? "Expandir projeto" : "Recolher projeto"}
                      >
                        <span className="text-muted-foreground">
                          {isCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </span>

                        {group.color ? (
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: group.color }}
                          />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}

                        <span className="truncate font-semibold tracking-tight text-foreground">
                          {group.name}
                        </span>

                        <span className="text-[11px] font-normal text-muted-foreground font-mono ml-0.5">
                          ({group.tasks.length > 0 ? `${activeCount}/${group.tasks.length}` : "0"})
                        </span>
                      </div>

                      {/* Ações do Cabeçalho de Projeto (Requisitos 1, 2, 3, 4) */}
                      {!group.isUnassigned && !exibindoArquivados && (
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              const project = projectsById.get(group.id);
                              if (project) setPlanningTarget({ project, configurationOnly: true });
                            }}
                            disabled={planning.loading || Boolean(planning.error)}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 disabled:opacity-40"
                            title={`Configurar agente de planejamento de ${group.name}`}
                            aria-label={`Configurar agente de planejamento de ${group.name}`}
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              const project = projectsById.get(group.id);
                              if (project) setPlanningTarget({ project });
                            }}
                            disabled={planning.loading || Boolean(planning.error)}
                            className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40"
                            title={`Planejar tarefa em ${group.name}`}
                            aria-label={`Planejar tarefa em ${group.name}`}
                          >
                            <ClipboardList className="w-3.5 h-3.5" />
                          </button>
                          {/* Botão Subir Projeto */}
                          <button
                            type="button"
                            disabled={!canUp}
                            aria-disabled={!canUp}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveProject(group.id, -1);
                            }}
                            className="botao-subir-projeto text-muted-foreground hover:text-foreground"
                            title={`Mover projeto ${group.name} para cima`}
                            aria-label={`Mover projeto ${group.name} para cima`}
                          >
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                              <path d="M8 3.5a.75.75 0 0 1 .53.22l4 4a.75.75 0 1 1-1.06 1.06L8.75 5.81v6.44a.75.75 0 0 1-1.5 0V5.81L4.53 8.78a.75.75 0 0 1-1.06-1.06l4-4A.75.75 0 0 1 8 3.5z"/>
                            </svg>
                          </button>

                          {/* Botão Descer Projeto */}
                          <button
                            type="button"
                            disabled={!canDown}
                            aria-disabled={!canDown}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveProject(group.id, 1);
                            }}
                            className="botao-descer-projeto text-muted-foreground hover:text-foreground"
                            title={`Mover projeto ${group.name} para baixo`}
                            aria-label={`Mover projeto ${group.name} para baixo`}
                          >
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                              <path d="M8 12.5a.75.75 0 0 1-.53-.22l-4-4a.75.75 0 0 1 1.06-1.06l2.72 2.97V3.75a.75.75 0 0 1 1.5 0v6.44l2.72-2.97a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-.53.22z"/>
                            </svg>
                          </button>

                          {/* Botão NPM RUN DEV e Logs */}
                          <div className="inline-flex items-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleRunDev(group.id);
                              }}
                              className={`botao-run-dev-projeto status-task-${runDevStatus}`}
                              title={`NPM RUN DEV (${runDevStatus})`}
                              aria-label={`Executar NPM RUN DEV em ${group.name}`}
                            >
                              {runDevStatus === "rodando" ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 48 48">
                                  <path fill="currentColor" fillRule="evenodd" d="M24 44c11.046 0 20-8.954 20-20S35.046 4 24 4S4 12.954 4 24s8.954 20 20 20ZM20 24v-6.928l6 3.464L32 24l-6 3.464l-6 3.464z" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" width="12" height="12">
                                  <path d="M0 0h24v24H0z" fill="none" />
                                  <path fill="currentColor" d="M6.51 18.87c.15.09.32.13.49.13s.36-.05.51-.14l10-6c.3-.18.49-.51.49-.86s-.18-.68-.49-.86l-10-6a.99.99 0 0 0-1.01-.01c-.31.18-.51.51-.51.87v12c0 .36.19.69.51.87Z" />
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLogsModalTarget({
                                  projectId: group.id,
                                  projectName: group.name,
                                  taskType: "dev",
                                });
                              }}
                              className="botao-logs-task-projeto text-muted-foreground"
                              title={`Ver logs de DEV de ${group.name}`}
                              aria-label={`Ver logs de DEV de ${group.name}`}
                            >
                              <Terminal className="w-2.5 h-2.5" />
                            </button>
                          </div>

                          {/* Botão NPM RUN BUILD e Logs */}
                          <div className="inline-flex items-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleRunBuild(group.id);
                              }}
                              className={`botao-build-projeto status-task-${runBuildStatus}`}
                              title={`NPM RUN BUILD (${runBuildStatus})`}
                              aria-label={`Executar NPM RUN BUILD em ${group.name}`}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12">
                                <path d="M0 0h24v24H0z" fill="none" />
                                <path fill="currentColor" d="M9.06 1.93C7.17 1.92 5.33 3.74 6.17 6H3a2 2 0 0 0-2 2v2a1 1 0 0 0 1 1h9V8h2v3h9a1 1 0 0 0 1-1V8a2 2 0 0 0-2-2h-3.17C19 2.73 14.6.42 12.57 3.24L12 4l-.57-.78c-.63-.89-1.5-1.28-2.37-1.29M9 4c.89 0 1.34 1.08.71 1.71S8 5.89 8 5a1 1 0 0 1 1-1m6 0c.89 0 1.34 1.08.71 1.71S14 5.89 14 5a1 1 0 0 1 1-1M2 12v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8h-9v8h-2v-8z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLogsModalTarget({
                                  projectId: group.id,
                                  projectName: group.name,
                                  taskType: "build",
                                });
                              }}
                              className="botao-logs-task-projeto text-muted-foreground"
                              title={`Ver logs de BUILD de ${group.name}`}
                              aria-label={`Ver logs de BUILD de ${group.name}`}
                            >
                              <Terminal className="w-2.5 h-2.5" />
                            </button>
                          </div>

                          {/* Botão Ocultar Projeto */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleHideProject(group.id);
                            }}
                            className="botao-ocultar-projeto text-muted-foreground hover:text-foreground"
                            title={`Ocultar projeto ${group.name} da lista`}
                            aria-label={`Ocultar projeto ${group.name}`}
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12">
                              <path
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.5 9.5 0 0 1 12 5c5 0 9 4.5 9 7a10.9 10.9 0 0 1-2.6 3.6M6.3 6.7C3.9 8.2 3 10.6 3 12c0 2.5 4 7 9 7a9.7 9.7 0 0 0 3.9-.8"
                              />
                            </svg>
                          </button>
                        </div>
                      )}

                      {/* Botão rápido "+" para adicionar tarefa no projeto (somente ativo) */}
                      {!exibindoArquivados && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNewTask(group.isUnassigned ? undefined : group.id);
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors cursor-pointer ml-1"
                          title={`Nova tarefa em ${group.name}`}
                          aria-label={`Nova tarefa em ${group.name}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </header>

                    {/* Corpo do Grupo: Lista de Tarefas em 1 Linha (quando não recolhido) */}
                    {!isCollapsed && (
                      <div className="flex flex-col gap-1 pt-0.5">
                        {/* Se não houver tarefas, não exibe mensagem de texto conforme Requisito 6 */}
                        {group.tasks.length > 0 &&
                          group.tasks.map((task) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              subtasks={subtasksByParent.get(task.id) || []}
                              project={task.projectId ? projectsById.get(task.projectId) : null}
                              companyPrefix={companyPrefix}
                              hasActiveLiveRun={runningAgentsByTaskId.has(task.id) || task.status === "in_progress"}
                              runningAgents={runningAgentsByTaskId.get(task.id) || []}
                              isArchivedMode={exibindoArquivados}
                              onHide={handleHideTask}
                              onArchive={handleArchiveTask}
                              onUnarchive={handleUnarchiveTask}
                              onRequestDelete={handleRequestDelete}
                              onPlan={(selectedTask) => {
                                const project = selectedTask.projectId
                                  ? projectsById.get(selectedTask.projectId)
                                  : null;
                                if (project) setPlanningTarget({ project, task: selectedTask });
                              }}
                            />
                          ))}
                      </div>
                    )}
                  </section>
                );
              })
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
                    <p className="text-xs font-medium">
                      {exibindoArquivados ? "Nenhuma tarefa arquivada" : "Tudo limpo por aqui"}
                    </p>
                    <p className="text-[11px] opacity-70 mt-0.5">
                      {exibindoArquivados
                        ? "Nenhuma tarefa foi arquivada até o momento."
                        : "Nenhuma tarefa ativa cadastrada."}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Acordeão de Itens Ocultos (Requisitos 1 e 7 — estilo MaxCode .itens-ocultos) */}
            {!exibindoArquivados && totalHiddenCount > 0 && (
              <div className="mt-4 pt-3 border-t border-border/50">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setHiddenAccordionOpen(!hiddenAccordionOpen)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setHiddenAccordionOpen(!hiddenAccordionOpen);
                    }
                  }}
                  className="flex items-center justify-between w-full px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none rounded hover:bg-accent/30"
                >
                  <div className="flex items-center gap-1.5">
                    {hiddenAccordionOpen ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Itens ocultos ({totalHiddenCount})</span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      sidebarStore.clearHiddenTasks();
                      sidebarStore.clearHiddenProjects();
                    }}
                    className="text-[11px] text-primary hover:underline lowercase font-normal cursor-pointer"
                    title="Restaurar todos os itens ocultos"
                  >
                    restaurar todos
                  </button>
                </div>

                {hiddenAccordionOpen && (
                  <div className="mt-2 space-y-2 pl-1">
                    {/* Projetos Ocultos (Requisito 1 — estilo MaxCode) */}
                    {hiddenProjectsList.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1">
                          Projetos Ocultos ({hiddenProjectsList.length})
                        </span>
                        {hiddenProjectsList.map((proj) => (
                          <div
                            key={proj.id}
                            className="flex items-center justify-between px-2 py-1 rounded bg-muted/40 hover:bg-muted/70 text-xs text-muted-foreground transition-colors select-none"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {proj.color ? (
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: proj.color }}
                                />
                              ) : (
                                <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              )}
                              <span className="truncate font-medium text-foreground/80" title={proj.name}>
                                {proj.name}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleUnhideProject(proj.id)}
                              className="botao-mostrar-projeto text-muted-foreground hover:text-foreground p-1"
                              title={`Mostrar projeto ${proj.name} na lista principal`}
                              aria-label={`Mostrar projeto ${proj.name}`}
                            >
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
                                />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tarefas Ocultas */}
                    {hiddenRootTasks.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1">
                          Tarefas Ocultas ({hiddenRootTasks.length})
                        </span>
                        {hiddenRootTasks.map((task) => {
                          const subs = subtasksByParent.get(task.id) || [];
                          return (
                            <div
                              key={task.id}
                              className="flex items-center justify-between px-2 py-1 rounded bg-muted/40 hover:bg-muted/70 text-xs text-muted-foreground transition-colors select-none"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <StatusIcon status={task.status} size="12px" />
                                {task.identifier && (
                                  <span className="font-mono text-[11px] font-semibold text-foreground/80 shrink-0">
                                    {task.identifier}
                                  </span>
                                )}
                                <span className="truncate text-foreground/70" title={task.title}>
                                  {task.title}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                {/* Restaurar */}
                                <button
                                  type="button"
                                  onClick={() => handleUnhideTask(task.id)}
                                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors cursor-pointer"
                                  title="Restaurar para a lista principal"
                                  aria-label="Restaurar tarefa"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>

                                {/* Remover definitivamente */}
                                <button
                                  type="button"
                                  onClick={() => handleRequestDelete(task, subs)}
                                  className="p-1 rounded text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                                  title="Remover definitivamente"
                                  aria-label="Remover definitivamente"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Modal de Confirmação de Exclusão Segura */}
      <TaskDeleteConfirmModal
        isOpen={deleteModalState.isOpen}
        task={deleteModalState.task}
        subtasksCount={deleteModalState.subtasks.length}
        loading={deleteModalState.loading}
        onConfirmCascade={handleConfirmCascade}
        onConfirmSingle={handleConfirmSingle}
        onCancel={handleCancelDelete}
      />
      {companyId && companyPrefix && (
        <PlanningDialog
          open={Boolean(planningTarget)}
          companyId={companyId}
          companyPrefix={companyPrefix}
          project={planningTarget?.project ?? null}
          sourceTask={planningTarget?.task}
          configurationOnly={planningTarget?.configurationOnly}
          bootstrap={planning.data}
          onClose={() => setPlanningTarget(null)}
          onSaved={planning.refresh}
        />
      )}
      {logsModalTarget && (
        <TaskLogsModal
          open={Boolean(logsModalTarget)}
          companyId={companyId!}
          projectId={logsModalTarget.projectId}
          projectName={logsModalTarget.projectName}
          taskType={logsModalTarget.taskType}
          onClose={() => setLogsModalTarget(null)}
        />
      )}
    </>
  );
}
