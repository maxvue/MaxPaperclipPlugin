/**
 * Formata um timestamp ISO de criação em formato de tempo decorrido compacto.
 * Exemplo: "< 1 min", "30 min", "2 h", "3 d", "2 sem".
 */
export function formatElapsedTime(dateInput: string | number | Date | null | undefined, nowInput?: number | Date): string {
  if (!dateInput) return "--";

  const targetDate = typeof dateInput === "string" || typeof dateInput === "number"
    ? new Date(dateInput)
    : dateInput;

  if (Number.isNaN(targetDate.getTime())) return "--";

  const now = nowInput ? new Date(nowInput).getTime() : Date.now();
  const diffMs = now - targetDate.getTime();

  if (diffMs < 0) return "< 1 min";

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);

  if (diffMin < 1) {
    return "< 1 min";
  }

  if (diffMin < 60) {
    return `${diffMin} min`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours} h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} d`;
  }

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) {
    return `${diffWeeks} sem`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} m`;
}
