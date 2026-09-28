import { useSyncExternalStore } from "react";

const STORAGE_KEY_IS_OPEN = "paperclip:plugin-task-sidebar:isOpen";
const STORAGE_KEY_SIDE = "paperclip:plugin-task-sidebar:side";

export type SidebarSide = "left" | "right";

interface SidebarState {
  isOpen: boolean;
  side: SidebarSide;
  expandedTaskIds: Set<string>;
  searchQuery: string;
  portalOwnerId: string | null;
}

function readInitialIsOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const item = window.localStorage.getItem(STORAGE_KEY_IS_OPEN);
    return item === null ? true : item === "true";
  } catch {
    return true;
  }
}

function readInitialSide(): SidebarSide {
  if (typeof window === "undefined") return "right";
  try {
    const item = window.localStorage.getItem(STORAGE_KEY_SIDE);
    return item === "left" ? "left" : "right";
  } catch {
    return "right";
  }
}

const toggleRegistry = new Map<string, { isVisible: boolean; registeredAt: number }>();

function computePortalOwner(): string | null {
  const visible = Array.from(toggleRegistry.entries()).filter(([_, m]) => m.isVisible);
  if (visible.length > 0) {
    // Retorna o toggle visível registrado mais recentemente (ex: task detail breadcrumb)
    visible.sort((a, b) => b[1].registeredAt - a[1].registeredAt);
    return visible[0][0];
  }
  // Se nenhum estiver explicitamente visível ainda, pega o mais recente
  const all = Array.from(toggleRegistry.entries());
  if (all.length > 0) {
    all.sort((a, b) => b[1].registeredAt - a[1].registeredAt);
    return all[0][0];
  }
  return null;
}

let state: SidebarState = {
  isOpen: readInitialIsOpen(),
  side: readInitialSide(),
  expandedTaskIds: new Set<string>(),
  searchQuery: "",
  portalOwnerId: null,
};

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function updatePortalOwner() {
  const next = computePortalOwner();
  if (state.portalOwnerId !== next) {
    state = { ...state, portalOwnerId: next };
    notify();
  }
}

export const sidebarStore = {
  getSnapshot(): SidebarState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setIsOpen(open: boolean) {
    if (state.isOpen === open) return;
    state = { ...state, isOpen: open };
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY_IS_OPEN, String(open));
      }
    } catch {
      // Ignora erro de storage
    }
    notify();
  },

  toggleIsOpen() {
    sidebarStore.setIsOpen(!state.isOpen);
  },

  setSide(side: SidebarSide) {
    if (state.side === side) return;
    state = { ...state, side };
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY_SIDE, side);
      }
    } catch {
      // Ignora erro de storage
    }
    notify();
  },

  toggleSide() {
    sidebarStore.setSide(state.side === "left" ? "right" : "left");
  },

  toggleTaskExpanded(taskId: string) {
    const next = new Set(state.expandedTaskIds);
    if (next.has(taskId)) {
      next.delete(taskId);
    } else {
      next.add(taskId);
    }
    state = { ...state, expandedTaskIds: next };
    notify();
  },

  isTaskExpanded(taskId: string): boolean {
    return state.expandedTaskIds.has(taskId);
  },

  setSearchQuery(query: string) {
    state = { ...state, searchQuery: query };
    notify();
  },

  registerToggle(id: string, isVisible = true) {
    toggleRegistry.set(id, { isVisible, registeredAt: Date.now() });
    updatePortalOwner();
  },

  unregisterToggle(id: string) {
    toggleRegistry.delete(id);
    updatePortalOwner();
  },

  updateToggleVisibility(id: string, isVisible: boolean) {
    const entry = toggleRegistry.get(id);
    if (entry) {
      if (entry.isVisible !== isVisible) {
        entry.isVisible = isVisible;
        updatePortalOwner();
      }
    } else {
      sidebarStore.registerToggle(id, isVisible);
    }
  },
};

export function useSidebarStore(): SidebarState {
  return useSyncExternalStore(
    sidebarStore.subscribe,
    sidebarStore.getSnapshot,
    sidebarStore.getSnapshot,
  );
}
