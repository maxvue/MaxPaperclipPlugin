import React from "react";
import { getTaskStatusLabel } from "./status.js";

interface StatusIconProps {
  status: string | null | undefined;
  className?: string;
  size?: number | string;
}

/**
 * Ícones geométricos de status conforme o padrão MaxCode,
 * utilizando rigorosamente as cores canônicas do Paperclip:
 *
 * - in_progress: Spinner circular animado (Azul)
 * - done / completed: Círculo com checkmark (Verde)
 * - todo: Relógio com ponteiros (Âmbar)
 * - in_review / review / planned: Prancheta/documento com check (Roxo)
 * - blocked: Círculo de alerta com exclamação (Vermelho)
 * - backlog: Círculo neutro com lâmpada (Cinza neutro)
 * - cancelled / canceled: Octógono com traço (Cinza esmaecido)
 */
export function StatusIcon({ status, className = "", size = "1em" }: StatusIconProps) {
  const normStatus = (status || "").toLowerCase().trim();
  const label = getTaskStatusLabel(status);

  let iconElement: React.ReactElement;

  switch (normStatus) {
    case "in_progress":
      iconElement = (
        <svg
          className={`inline-block shrink-0 animate-spin text-blue-600 dark:text-blue-400 ${className}`}
          viewBox="0 0 16 16"
          width={size}
          height={size}
          fill="currentColor"
          role="img"
          aria-label={label}
        >
          <title>{label}</title>
          <path opacity="0.3" d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5A6.5 6.5 0 0 0 8 1.5zM8 0a8 8 0 1 1-8 8 8 8 0 0 1 8-8z" />
          <path d="M8 0a8 8 0 0 1 8 8h-1.5A6.5 6.5 0 0 0 8 1.5z" />
        </svg>
      );
      break;

    case "done":
    case "completed":
      iconElement = (
        <svg
          className={`inline-block shrink-0 text-emerald-600 dark:text-emerald-400 ${className}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          role="img"
          aria-label={label}
        >
          <title>{label}</title>
          <path d="M0 0h24v24H0z" fill="none" />
          <path
            fill="currentColor"
            d="m10.6 13.8l-2.15-2.15q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7L9.9 15.9q.3.3.7.3t.7-.3l5.65-5.65q.275-.275.275-.7t-.275-.7t-.7-.275t-.7.275zM12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"
          />
        </svg>
      );
      break;

    case "todo":
      iconElement = (
        <svg
          className={`inline-block shrink-0 text-amber-600 dark:text-amber-400 ${className}`}
          viewBox="0 0 16 16"
          width={size}
          height={size}
          fill="currentColor"
          role="img"
          aria-label={label}
        >
          <title>{label}</title>
          <path d="M8 1a7 7 0 1 0 7 7A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1-5.5 5.5A5.5 5.5 0 0 1 8 2.5zM7.25 4v4.25l3.25 1.95.75-1.23-2.5-1.5V4z" />
        </svg>
      );
      break;

    case "in_review":
    case "review":
    case "planned":
      iconElement = (
        <svg
          className={`inline-block shrink-0 text-purple-600 dark:text-purple-400 ${className}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          role="img"
          aria-label={label}
        >
          <title>{label}</title>
          <path d="M0 0h24v24H0z" fill="none" />
          <g fill="currentColor">
            <path d="M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5z" />
            <path
              fillRule="evenodd"
              d="M11 7V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9h5a2 2 0 0 0 2-2m4.707 5.707a1 1 0 0 0-1.414-1.414L11 14.586l-1.293-1.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0z"
              clipRule="evenodd"
            />
          </g>
        </svg>
      );
      break;

    case "blocked":
      iconElement = (
        <svg
          className={`inline-block shrink-0 text-rose-600 dark:text-rose-400 ${className}`}
          viewBox="0 0 16 16"
          width={size}
          height={size}
          fill="currentColor"
          role="img"
          aria-label={label}
        >
          <title>{label}</title>
          <path d="M8 1a7 7 0 1 0 7 7A7 7 0 0 0 8 1zm0 1.5A5.5 5.5 0 1 1 2.5 8 5.5 5.5 0 0 1 8 2.5zm-2.47 3.03a.75.75 0 0 0-1.06 1.06L6.94 8 4.47 10.47a.75.75 0 1 0 1.06 1.06L8 9.06l2.47 2.47a.75.75 0 0 0 1.06-1.06L9.06 8l2.47-2.47a.75.75 0 0 0-1.06-1.06L8 6.94z" />
        </svg>
      );
      break;

    case "cancelled":
    case "canceled":
      iconElement = (
        <svg
          className={`inline-block shrink-0 text-muted-foreground/60 ${className}`}
          viewBox="0 0 16 16"
          width={size}
          height={size}
          fill="currentColor"
          role="img"
          aria-label={label}
        >
          <title>{label}</title>
          <path d="M4.47.22A.75.75 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.75.75 0 0 1-.22.53l-4.25 4.25A.75.75 0 0 1 11 16H5a.75.75 0 0 1-.53-.22L.22 11.53A.75.75 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4m0 8a1 1 0 1 1 0-2a1 1 0 0 1 0 2" />
        </svg>
      );
      break;

    case "backlog":
    default:
      iconElement = (
        <svg
          className={`inline-block shrink-0 text-muted-foreground ${className}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          role="img"
          aria-label={label}
        >
          <title>{label}</title>
          <path d="M0 0h24v24H0z" fill="none" />
          <path
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M9 18h6m-5 3h4m-5-6c.001-2-.499-2.5-1.5-3.5S6.025 9.487 6 8c-.047-3.05 2-5 6-5c4.001 0 6.049 1.95 6 5c-.023 1.487-.5 2.5-1.5 3.5c-.999 1-1.499 1.5-1.5 3.5"
          />
        </svg>
      );
      break;
  }

  return (
    <span className="inline-flex items-center" title={label}>
      {iconElement}
    </span>
  );
}
