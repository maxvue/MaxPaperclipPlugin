import React, { useState, useEffect, useId, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { sidebarStore, useSidebarStore } from "./store.js";
import { TaskSidebarRightColumn } from "./TaskSidebarRightColumn.js";
import { AgentChatSessionsSidebar } from "../chat-sessions/AgentChatSessionsSidebar.js";
import { AgentChatContextSidebar } from "../chat-context/AgentChatContextSidebar.js";
import { getSettings, subscribeSettings } from "../../config/settings.js";

interface TaskSidebarToggleProps {
  context?: {
    companyId?: string | null;
    companyPrefix?: string | null;
  };
}

/**
 * Localiza o container pai direto onde o main-content e o PropertiesPanel coexistem,
 * garantindo que a coluna de tarefas seja montada como um irmão no mesmo layout flex.
 */
function findLayoutFlexParent(): HTMLElement | null {
  if (typeof document === "undefined") return null;

  const mainEl = document.getElementById("main-content");
  if (mainEl) {
    // 1. Procura o container flex-1 min-h-0 que engloba o main e o PropertiesPanel
    const directFlex = mainEl.closest<HTMLElement>(".flex.flex-1.min-h-0");
    if (directFlex) return directFlex;

    // 2. Procura qualquer elemento pai com display flex
    let curr = mainEl.parentElement;
    while (curr && curr !== document.body) {
      if (curr.classList.contains("flex") && curr.classList.contains("min-h-0")) {
        return curr;
      }
      curr = curr.parentElement;
    }
  }

  // 3. Fallback: shell-center
  const shellCenter = document.querySelector<HTMLElement>('[data-slot="shell-center"]');
  if (shellCenter) {
    const inner = shellCenter.querySelector<HTMLElement>(".flex.flex-1.min-h-0");
    if (inner) return inner;
  }

  return null;
}

export function TaskSidebarToggle({ context }: TaskSidebarToggleProps) {
  const instanceId = useId();
  const { isOpen, side, portalOwnerId } = useSidebarStore();
  const [container, setContainer] = useState<HTMLElement | null>(findLayoutFlexParent);
  const [moduleEnabled, setModuleEnabled] = useState(() => getSettings().tasks);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    return subscribeSettings((settings) => {
      setModuleEnabled(settings.tasks);
    });
  }, []);

  const checkIsVisible = useCallback(() => {
    if (typeof document === "undefined") return true;
    if (!buttonRef.current) return true;
    const el = buttonRef.current;
    // Se o elemento estiver dentro de um container oculto (.hidden) no Layout
    if (el.closest(".hidden")) return false;
    if (el.offsetParent === null && window.getComputedStyle(el).display === "none") {
      return false;
    }
    return true;
  }, []);

  // Registra a instância no singleton registry para evitar renderização duplicada (ex: em páginas de tarefas)
  useEffect(() => {
    const isVis = checkIsVisible();
    sidebarStore.registerToggle(instanceId, isVis);

    const updateTarget = () => {
      const target = findLayoutFlexParent();
      if (target) {
        setContainer((prev) => (prev !== target ? target : prev));
      }
      sidebarStore.updateToggleVisibility(instanceId, checkIsVisible());
    };

    updateTarget();

    const observer = new MutationObserver(() => {
      updateTarget();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      observer.disconnect();
      sidebarStore.unregisterToggle(instanceId);
    };
  }, [instanceId, checkIsVisible]);

  const isPortalOwner = portalOwnerId === instanceId;

  const toggleTitle = isOpen
    ? side === "left"
      ? "Recolher coluna de tarefas à esquerda"
      : "Recolher coluna de tarefas à direita"
    : side === "left"
    ? "Fixar coluna de tarefas à esquerda"
    : "Fixar coluna de tarefas à direita";

  const renderIcon = () => {
    if (side === "left") {
      return isOpen ? (
        <PanelLeftClose className="w-4 h-4 mr-1.5 text-primary" />
      ) : (
        <PanelLeftOpen className="w-4 h-4 mr-1.5" />
      );
    }
    return isOpen ? (
      <PanelRightClose className="w-4 h-4 mr-1.5 text-primary" />
    ) : (
      <PanelRightOpen className="w-4 h-4 mr-1.5" />
    );
  };

  if (!moduleEnabled) return null;

  return (
    <>
      {/* Botão de Alternância no BreadcrumbBar */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => sidebarStore.toggleIsOpen()}
        className={`inline-flex items-center justify-center h-8 px-2.5 rounded-md text-xs font-medium transition-colors border ${
          isOpen
            ? "bg-accent text-accent-foreground border-border/80 shadow-xs"
            : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40 border-transparent"
        }`}
        aria-label={toggleTitle}
        title={toggleTitle}
      >
        {renderIcon()}
        <span className="hidden sm:inline font-medium">Tarefas</span>
      </button>

      {/* Renderiza o painel de tarefas no container flex APENAS se esta instância for a proprietária única do portal */}
      {isPortalOwner && container
        ? createPortal(
            <TaskSidebarRightColumn context={context} />,
            container,
          )
        : null}

      {/* Renderiza o painel de sessões de chat à esquerda em rotas de chat */}
      {isPortalOwner ? <AgentChatSessionsSidebar /> : null}

      {/* Renderiza o painel de contexto e métricas da conversa à direita em rotas de chat */}
      {isPortalOwner ? <AgentChatContextSidebar /> : null}
    </>
  );
}
