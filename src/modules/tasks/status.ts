/**
 * Utilitários para mapeamento de status de tarefas e subtarefas
 * alinhados ao sistema de cores e termos do Paperclip:
 *
 * - Azul = Em Andamento (in_progress)
 * - Amarelo = A Fazer (todo)
 * - Roxo = Em Revisão (in_review / review)
 * - Vermelho = Bloqueado (blocked)
 * - Verde = Concluído (done / completed)
 */

export interface StatusBadgeConfig {
  label: string;
  colorClass: string;
}

/**
 * Retorna as classes Tailwind de cores (fundo, texto e borda) para o status da tarefa.
 */
export function getTaskStatusColorClass(status: string | null | undefined): string {
  if (!status) {
    return "bg-muted text-muted-foreground border-border";
  }

  switch (status.toLowerCase()) {
    // Azul = Em Andamento
    case "in_progress":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";

    // Amarelo = A Fazer
    case "todo":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";

    // Roxo = Em Revisão
    case "in_review":
    case "review":
      return "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30";

    // Vermelho = Bloqueado
    case "blocked":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";

    // Verde = Concluído
    case "done":
    case "completed":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";

    // Backlog / Neutro
    case "backlog":
      return "bg-muted/70 text-muted-foreground border-border";

    // Cancelado
    case "cancelled":
    case "canceled":
      return "bg-muted/50 text-muted-foreground/70 border-border/60 line-through";

    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/**
 * Retorna o rótulo legível em Português do Brasil para o status da tarefa.
 */
export function getTaskStatusLabel(status: string | null | undefined): string {
  if (!status) return "--";

  switch (status.toLowerCase()) {
    case "in_progress":
      return "Em andamento";
    case "todo":
      return "A fazer";
    case "in_review":
    case "review":
      return "Em revisão";
    case "blocked":
      return "Bloqueada";
    case "done":
    case "completed":
      return "Concluída";
    case "backlog":
      return "Backlog";
    case "cancelled":
    case "canceled":
      return "Cancelada";
    default:
      return status.replace(/_/g, " ");
  }
}

/**
 * Retorna a configuração completa (label e classes de cores) para renderização do badge de status.
 */
export function getTaskStatusConfig(status: string | null | undefined): StatusBadgeConfig {
  return {
    label: getTaskStatusLabel(status),
    colorClass: getTaskStatusColorClass(status),
  };
}
