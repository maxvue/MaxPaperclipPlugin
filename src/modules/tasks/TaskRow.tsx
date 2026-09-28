import React from "react";
import { ChevronRight, ChevronDown, EyeOff, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type { IssueSummary, ProjectSummary } from "./types.js";
import { formatElapsedTime } from "./time.js";
import { sidebarStore, useSidebarStore } from "./store.js";
import { StatusIcon } from "./StatusIcon.js";

export interface RunningAgentInfo {
  id: string;
  name: string;
  status?: string;
}

interface TaskRowProps {
  task: IssueSummary;
  subtasks?: IssueSummary[];
  project?: ProjectSummary | null;
  companyPrefix?: string | null;
  hasActiveLiveRun?: boolean;
  runningAgents?: RunningAgentInfo[];
  isSubtask?: boolean;
  isArchivedMode?: boolean;
  onHide?: (taskId: string) => void;
  onArchive?: (taskId: string) => void;
  onUnarchive?: (taskId: string) => void;
  onRequestDelete?: (task: IssueSummary, subtasks: IssueSummary[]) => void;
}

/**
 * Retorna as classes de cor da borda esquerda (estilo MaxCode) conforme o status.
 */
function getBorderStatusColor(status: string | null | undefined): string {
  if (!status) return "border-l-border";
  switch (status.toLowerCase()) {
    case "in_progress":
      return "border-l-blue-500";
    case "todo":
      return "border-l-amber-500/80";
    case "done":
    case "completed":
      return "border-l-emerald-500";
    case "in_review":
    case "review":
    case "planned":
      return "border-l-purple-500";
    case "blocked":
      return "border-l-rose-500";
    case "cancelled":
    case "canceled":
      return "border-l-border/50";
    case "backlog":
    default:
      return "border-l-border";
  }
}

/**
 * Retorna a classe e rótulo do ponto indicador de atividade no canto de datas.
 */
function getActivityDotConfig(status: string | null | undefined, hasActiveLiveRun: boolean) {
  if (hasActiveLiveRun || status === "in_progress") {
    return { color: "bg-blue-500 animate-pulse", label: "Em execução" };
  }
  switch ((status || "").toLowerCase()) {
    case "done":
    case "completed":
      return { color: "bg-emerald-500", label: "Concluída" };
    case "todo":
      return { color: "bg-amber-500", label: "Aguardando" };
    case "in_review":
    case "review":
    case "planned":
      return { color: "bg-purple-500", label: "Em revisão" };
    case "blocked":
      return { color: "bg-rose-500", label: "Bloqueada" };
    default:
      return { color: "bg-muted-foreground/40", label: "Atividade recente" };
  }
}

export function TaskRow({
  task,
  subtasks = [],
  project,
  companyPrefix,
  hasActiveLiveRun = false,
  runningAgents = [],
  isSubtask = false,
  isArchivedMode = false,
  onHide,
  onArchive,
  onUnarchive,
  onRequestDelete,
}: TaskRowProps) {
  const store = useSidebarStore();
  const isExpanded = store.expandedTaskIds.has(task.id);
  const hasSubtasks = subtasks.length > 0;
  const isDone = task.status === "done" || task.status === "completed";
  const isArchived = Boolean(task.hiddenAt) || isArchivedMode;

  const handleRowClick = (e: React.MouseEvent) => {
    // Se o clique veio de um botão de ação rápida ou link, não alterna expansão
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a")) {
      return;
    }

    if (hasSubtasks) {
      sidebarStore.toggleTaskExpanded(task.id);
    }
  };

  const handleToggleSubtasks = (e: React.MouseEvent) => {
    e.stopPropagation();
    sidebarStore.toggleTaskExpanded(task.id);
  };

  const borderClass = getBorderStatusColor(task.status);
  const activityDot = getActivityDotConfig(task.status, hasActiveLiveRun);

  const taskUrl = companyPrefix && (task.identifier || task.id)
    ? `/${companyPrefix}/issues/${task.identifier || task.id}`
    : null;

  return (
    <div className="flex flex-col w-full group/row">
      {/* Linha Principal (1 Linha Compacta ~32-34px) */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            if (hasSubtasks) {
              e.preventDefault();
              sidebarStore.toggleTaskExpanded(task.id);
            }
          }
        }}
        className={`max-task-row group relative flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md border-l-2 bg-card/60 hover:bg-accent/40 transition-colors select-none text-left cursor-pointer ${borderClass} ${
          isSubtask ? "text-xs bg-card/30" : "text-xs shadow-2xs"
        }`}
        title={hasSubtasks ? "Clique para expandir/recolher subtarefas" : task.title}
      >
        <style>{`
          .max-task-canto {
            box-sizing: border-box;
            flex-shrink: 0;
            display: grid;
            align-items: center;
            justify-items: end;
            width: 5.5rem;
            min-width: 5.5rem;
          }
          .max-task-canto > * {
            grid-area: 1 / 1;
          }
          .max-task-datas {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            justify-content: center;
            gap: 1px;
            white-space: nowrap;
            opacity: 1;
            visibility: visible;
            transition: opacity 0.15s ease-in-out;
          }
          .max-task-acoes {
            display: flex;
            align-items: center;
            gap: 3px;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: opacity 0.15s ease-in-out;
          }
          .max-task-row:hover .max-task-datas {
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          .max-task-row:hover .max-task-acoes {
            opacity: 1 !important;
            visibility: visible !important;
            pointer-events: auto !important;
          }
          .max-task-row:focus-within .max-task-datas {
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          .max-task-row:focus-within .max-task-acoes {
            opacity: 1 !important;
            visibility: visible !important;
            pointer-events: auto !important;
          }
        `}</style>

        {/* Lado Esquerdo: Chevron (se houver filhos) + StatusIcon + Identificador + Título + Agentes */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          {/* Chevron de Subtarefas */}
          {hasSubtasks ? (
            <button
              type="button"
              onClick={handleToggleSubtasks}
              className="p-0.5 -ml-1 text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer rounded shrink-0"
              title={isExpanded ? "Recolher subtarefas" : "Expandir subtarefas"}
              aria-label={isExpanded ? "Recolher subtarefas" : "Expandir subtarefas"}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : isSubtask ? (
            <span className="w-2.5 h-px bg-border/80 shrink-0 -ml-0.5 mr-0.5" />
          ) : null}

          {/* StatusIcon (Ícone Geométrico do MaxCode com cores do Paperclip) */}
          <div className="shrink-0 flex items-center">
            <StatusIcon status={task.status} size={isSubtask ? "13px" : "14px"} />
          </div>

          {/* Identificador da Tarefa (ex.: ENG-42) */}
          {task.identifier ? (
            taskUrl ? (
              <a
                href={taskUrl}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 font-mono text-[11px] font-semibold text-primary/90 hover:text-primary hover:underline transition-colors"
                title={`Abrir ${task.identifier}`}
              >
                {task.identifier}
              </a>
            ) : (
              <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
                {task.identifier}
              </span>
            )
          ) : null}

          {/* Título da Tarefa Truncado (com risco tachado de opacidade 0.5 em itens concluídos) */}
          <span
            className={`truncate font-medium ${
              isDone ? "text-muted-foreground/80 font-normal" : "text-foreground"
            }`}
            style={
              isDone
                ? {
                    textDecorationLine: "line-through",
                    textDecorationColor: "rgba(150, 150, 150, 0.5)",
                  }
                : undefined
            }
            title={task.title}
          >
            {task.title}
          </span>

          {/* Tags de Agentes Executando a Tarefa com Ícone de Status */}
          {runningAgents.length > 0 ? (
            <div className="shrink-0 flex items-center gap-1 overflow-hidden">
              {runningAgents.map((agent) => (
                <span
                  key={agent.id}
                  className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                  title={`Agente ${agent.name} executando agora`}
                >
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                  <span className="max-w-[75px] truncate font-medium">{agent.name}</span>
                </span>
              ))}
            </div>
          ) : hasActiveLiveRun ? (
            <span
              className="shrink-0 inline-flex items-center gap-1 px-1 py-0.2 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              title="Agente executando agora"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span className="hidden sm:inline">Ao vivo</span>
            </span>
          ) : null}
        </div>

        {/* Canto Direito (.linha-canto em CSS Grid): Datas em repouso / Ações no hover */}
        <div className="max-task-canto relative">
          {/* Camada 1: Datas em Repouso */}
          <div className="max-task-datas text-right leading-none select-none">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/85 font-mono">
              <span title={`Atualizada em ${new Date(task.updatedAt).toLocaleString("pt-BR")}`}>
                {formatElapsedTime(task.updatedAt)}
              </span>
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${activityDot.color}`}
                title={activityDot.label}
              />
            </div>
            <div
              className="text-[9.5px] text-muted-foreground/50 font-mono mt-0.5"
              title={`Criada em ${new Date(task.createdAt).toLocaleString("pt-BR")}`}
            >
              {formatElapsedTime(task.createdAt)}
            </div>
          </div>

          {/* Camada 2: Botões Rápidos no Hover */}
          <div className="max-task-acoes">
            {/* Botão Ocultar (somente no modo normal) */}
            {!isArchived && onHide && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onHide(task.id);
                }}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors cursor-pointer"
                title="Ocultar tarefa do painel"
                aria-label="Ocultar tarefa do painel"
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Botão Desarquivar (no modo arquivados) */}
            {isArchived && onUnarchive && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnarchive(task.id);
                }}
                className="p-1 rounded text-muted-foreground hover:text-amber-500 hover:bg-amber-500/15 transition-colors cursor-pointer"
                title="Desarquivar tarefa (restaurar para ativas)"
                aria-label="Desarquivar tarefa"
              >
                <ArchiveRestore className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Botão Arquivar (no modo normal) */}
            {!isArchived && onArchive && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive(task.id);
                }}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors cursor-pointer"
                title="Arquivar tarefa"
                aria-label="Arquivar tarefa"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Botão Remover Permanentemente */}
            {onRequestDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestDelete(task, subtasks);
                }}
                className="p-1 rounded text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                title="Remover permanentemente"
                aria-label="Remover permanentemente"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Renderização Aninhada de Subtarefas quando Expandido */}
      {hasSubtasks && isExpanded && (
        <div className="pl-4 ml-2.5 border-l-2 border-border/40 flex flex-col gap-1 my-1">
          {subtasks.map((subtask) => (
            <TaskRow
              key={subtask.id}
              task={subtask}
              subtasks={[]}
              project={project}
              companyPrefix={companyPrefix}
              hasActiveLiveRun={subtask.status === "in_progress"}
              runningAgents={[]}
              isSubtask={true}
              isArchivedMode={isArchivedMode}
              onHide={onHide}
              onArchive={onArchive}
              onUnarchive={onUnarchive}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
