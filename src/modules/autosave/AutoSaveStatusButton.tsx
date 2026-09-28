import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { autoSaveEngine, type AutoSaveStatus } from "./engine.js";
import { getSettings, subscribeSettings } from "../../config/settings.js";

interface AutoSaveStatusButtonProps {
  context?: {
    companyId?: string | null;
    companyPrefix?: string | null;
  };
}

export function AutoSaveStatusButton({ context }: AutoSaveStatusButtonProps) {
  const [status, setStatus] = useState<AutoSaveStatus>(() => autoSaveEngine.currentStatus);
  const [enabled, setEnabled] = useState<boolean>(() => getSettings().autosave);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const unsubStatus = autoSaveEngine.subscribe((nextStatus) => {
      setStatus(nextStatus);
    });
    const unsubSettings = subscribeSettings((settings) => {
      setEnabled(settings.autosave);
    });
    return () => {
      unsubStatus();
      unsubSettings();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPortalTarget(null);
      return;
    }

    const findTarget = () => {
      const ol = document.querySelector('ol[data-slot="breadcrumb-list"]');
      if (ol) {
        let li = ol.querySelector<HTMLLIElement>('li[data-autosave-portal="true"]');
        if (!li) {
          li = document.createElement("li");
          li.setAttribute("data-autosave-portal", "true");
          li.className = "ml-3 inline-flex items-center shrink-0";
          ol.appendChild(li);
        }
        setPortalTarget(li);
        return;
      }

      const h1Container = document.querySelector(".min-w-0.overflow-hidden.flex-1 h1, .min-w-0.overflow-hidden.flex-1");
      if (h1Container) {
        let span = h1Container.querySelector<HTMLSpanElement>('span[data-autosave-portal="true"]');
        if (!span) {
          span = document.createElement("span");
          span.setAttribute("data-autosave-portal", "true");
          span.className = "ml-3 inline-flex items-center shrink-0 font-normal normal-case text-xs";
          h1Container.appendChild(span);
        }
        setPortalTarget(span);
        return;
      }

      setPortalTarget(null);
    };

    findTarget();

    const observer = new MutationObserver(() => {
      findTarget();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      const existing = document.querySelectorAll('[data-autosave-portal="true"]');
      existing.forEach((el) => el.remove());
    };
  }, [enabled]);

  if (!enabled) return null;

  const getStatusConfig = () => {
    switch (status) {
      case "error":
        return {
          title: "Auto-save: não foi possível confirmar a persistência",
          colorClass: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]",
          label: "Não confirmado",
          textClass: "text-rose-500",
        };
      case "in_debounce":
        return {
          title: "Auto-save: Salvando alterações em 1s...",
          colorClass: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse",
          label: "Salvando...",
          textClass: "text-amber-500",
        };
      case "saved":
        return {
          title: "Auto-save: Alterações salvas!",
          colorClass: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]",
          label: "Salvo",
          textClass: "text-emerald-500",
        };
      case "idle":
      default:
        return {
          title: "Auto-save: Ativo (Aguardando digitação)",
          colorClass: "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]",
          label: "Auto-save",
          textClass: "text-muted-foreground hover:text-foreground",
        };
    }
  };

  const config = getStatusConfig();

  const button = (
    <button
      type="button"
      onClick={() => {
        if (status === "in_debounce") {
          autoSaveEngine.executeSave();
        }
      }}
      className={`inline-flex items-center justify-center h-8 px-2 rounded-md text-xs font-medium transition-all duration-200 bg-transparent border-0 select-none ${config.textClass}`}
      aria-label={config.title}
      title={config.title}
    >
      <span className="font-medium text-[11px]">{config.label}</span>
      <span className={`w-2.5 h-2.5 rounded-full ml-1.5 transition-colors duration-200 ${config.colorClass}`} />
    </button>
  );

  if (portalTarget) {
    return createPortal(button, portalTarget);
  }

  return button;
}
