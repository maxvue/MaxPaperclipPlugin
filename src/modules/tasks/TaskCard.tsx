import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Play, ExternalLink, Bot, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import type { IssueSummary, LiveRun, ProjectSummary } from "./types.js";
import { formatElapsedTime } from "./time.js";
import { sidebarStore, useSidebarStore } from "./store.js";
import { fetchIssueLiveRuns } from "./api.js";
import { getTaskStatusConfig } from "./status.js";

interface TaskCardProps {
  task: IssueSummary;
  subtasks: IssueSummary[];
  project?: ProjectSummary | null;
  companyPrefix?: string | null;
  hasActiveLiveRun?: boolean;
}

export function TaskCard({
  task,
  subtasks,
  project,
  companyPrefix,
  hasActiveLiveRun = false,
}: TaskCardProps) {
  const store = useSidebarStore();
  const isExpanded = store.expandedTaskIds.has(task.id);
  const [taskRuns, setTaskRuns] = useState<LiveRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  // Quando expandido, busca detalhes das execuções específicas da tarefa
  useEffect(() => {
    if (!isExpanded) return;
    let mounted = true;
    setLoadingRuns(true);
    fetchIssueLiveRuns(task.id)
      .then((runs) => {
        if (mounted) setTaskRuns(runs);
      })
      .finally(() => {
        if (mounted) setLoadingRuns(false);
      });

    return () => {
      mounted = false;
    };
  }, [isExpanded, task.id]);

  const timeAgo = formatElapsedTime(task.createdAt);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    sidebarStore.toggleTaskExpanded(task.id);
  };

  const taskStatusConfig = getTaskStatusConfig(task.status);

  const taskUrl = companyPrefix && (task.identifier || task.id)
    ? `/${companyPrefix}/issues/${task.identifier || task.id}`
    : null;

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 hover:bg-accent/20 transition-colors shadow-xs overflow-hidden">
      {/* Cabeçalho do Card: Projeto, Tempo Relativo e Status de Execução */}
      <div className="flex items-center justify-between gap-1.5 px-3 pt-2.5 pb-1 text-xs text-muted-foreground border-b border-border/30">
        <div className="flex items-center gap-1.5 min-w-0">
          {project ? (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground truncate max-w-[140px]"
              title={`Projeto: ${project.name}`}
            >
              {project.name}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/70 italic">Sem projeto</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Indicador pulsante de execução ativa por Agente */}
          {hasActiveLiveRun && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              title="Agente de IA executando agora"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Ao vivo
            </span>
          )}

          {/* Tempo decorrido desde a criação */}
          <span
            className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground"
            title={`Criada em ${new Date(task.createdAt).toLocaleString("pt-BR")}`}
          >
            <Clock className="w-3 h-3 opacity-70" />
            {timeAgo}
          </span>
        </div>
      </div>

      {/* Linha do Título: Clicar no título abre para baixo conforme requisito do usuário */}
      <div className="p-3">
        <div
          role="button"
          tabIndex={0}
          onClick={handleToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              sidebarStore.toggleTaskExpanded(task.id);
            }
          }}
          className="group flex items-start justify-between gap-2 cursor-pointer select-none text-left"
          title="Clique para expandir/recolher subtarefas e execuções"
        >
          <div className="flex items-start gap-1.5 min-w-0 flex-1">
            <span className="mt-0.5 text-muted-foreground/70 group-hover:text-foreground transition-colors shrink-0">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-mono text-muted-foreground mr-1.5">
                {task.identifier || `#${task.issueNumber || ""}`}
              </span>
              <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors break-words">
                {task.title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 pt-0.5">
            <span
              className={`inline-block px-1.5 py-0.5 text-[10px] rounded font-medium border ${taskStatusConfig.colorClass}`}
            >
              {taskStatusConfig.label}
            </span>

            {taskUrl && (
              <a
                href={taskUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                title="Abrir detalhes da tarefa"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Área Expandida para Baixo: Subtarefas e Execuções */}
        {isExpanded && (
          <div className="mt-3 pt-2.5 border-t border-border/40 space-y-3 animate-in fade-in-50 duration-150">
            {/* Seção de Execuções de Agentes */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1.5">
                <span className="flex items-center gap-1">
                  <Bot className="w-3 h-3 text-primary" />
                  Execuções de IA
                </span>
                {taskRuns.length > 0 && (
                  <span className="text-[10px] font-mono opacity-80">{taskRuns.length}</span>
                )}
              </div>

              {loadingRuns ? (
                <div className="text-[11px] text-muted-foreground py-1 italic">Carregando execuções...</div>
              ) : taskRuns.length > 0 ? (
                <div className="space-y-1.5">
                  {taskRuns.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between p-2 rounded bg-muted/40 border border-border/40 text-xs"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {run.status === "running" ? (
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                        ) : run.status === "failed" ? (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        )}
                        <span className="font-medium truncate text-foreground text-[11px]">
                          {run.agentName || "Agente IA"}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {run.startedAt ? formatElapsedTime(run.startedAt) : "--"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground/80 py-1 bg-muted/20 px-2 rounded">
                  Nenhuma execução recente do agente.
                </div>
              )}
            </div>

            {/* Seção de Subtarefas */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1.5">
                <span className="flex items-center gap-1">
                  <Play className="w-3 h-3 text-secondary-foreground" />
                  Subtarefas
                </span>
                <span className="text-[10px] font-mono opacity-80">{subtasks.length}</span>
              </div>

              {subtasks.length > 0 ? (
                <div className="space-y-1.5 pl-1.5 border-l-2 border-border/50">
                  {subtasks.map((sub) => {
                    const subUrl = companyPrefix && (sub.identifier || sub.id)
                      ? `/${companyPrefix}/issues/${sub.identifier || sub.id}`
                      : null;
                    const subStatusConfig = getTaskStatusConfig(sub.status);
                    return (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between gap-1.5 p-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors text-xs"
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-1">
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {sub.identifier || `#${sub.issueNumber || ""}`}
                          </span>
                          <span className="truncate text-[11px] text-foreground font-normal">
                            {sub.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`px-1 py-0.2 text-[9px] rounded font-medium border ${subStatusConfig.colorClass}`}
                          >
                            {subStatusConfig.label}
                          </span>
                          {subUrl && (
                            <a
                              href={subUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted-foreground hover:text-foreground"
                              title="Abrir subtarefa"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground/80 py-1 bg-muted/20 px-2 rounded">
                  Nenhuma subtarefa cadastrada.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
