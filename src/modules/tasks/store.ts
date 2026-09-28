import { useSyncExternalStore } from "react";

const STORAGE_KEY_IS_OPEN = "paperclip:plugin-task-sidebar:isOpen";
const STORAGE_KEY_SIDE = "paperclip:plugin-task-sidebar:side";
const STORAGE_KEY_HIDDEN_TASKS = "paperclip:plugin-task-sidebar:hiddenTasks";
const STORAGE_KEY_COLLAPSED_PROJECTS = "paperclip:plugin-task-sidebar:collapsedProjects";
const STORAGE_KEY_HIDDEN_PROJECTS = "paperclip:plugin-task-sidebar:hiddenProjects";
const STORAGE_KEY_PROJECTS_ORDER = "paperclip:plugin-task-sidebar:projectsOrder";

export type SidebarSide = "left" | "right";
export type TaskRunStatus = "parado" | "rodando" | "erro";

export interface SidebarState {
  isOpen: boolean;
  side: SidebarSide;
  expandedTaskIds: Set<string>;
  hiddenTaskIds: Set<string>;
  collapsedProjectIds: Set<string>;
  hiddenProjectIds: Set<string>;
  projectsOrder: string[];
  runDevStates: Record<string, TaskRunStatus>;
  runBuildStates: Record<string, TaskRunStatus>;
  exibindoArquivados: boolean;
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

function readInitialHiddenTasks(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_HIDDEN_TASKS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function readInitialCollapsedProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_COLLAPSED_PROJECTS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function readInitialHiddenProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_HIDDEN_PROJECTS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function readInitialProjectsOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PROJECTS_ORDER);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistHiddenTasks(hidden: Set<string>) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_HIDDEN_TASKS, JSON.stringify(Array.from(hidden)));
    }
  } catch {
    // Ignora erro
  }
}

function persistCollapsedProjects(collapsed: Set<string>) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_COLLAPSED_PROJECTS, JSON.stringify(Array.from(collapsed)));
    }
  } catch {
    // Ignora erro
  }
}

function persistHiddenProjects(hidden: Set<string>) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_HIDDEN_PROJECTS, JSON.stringify(Array.from(hidden)));
    }
  } catch {
    // Ignora erro
  }
}

function persistProjectsOrder(order: string[]) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_PROJECTS_ORDER, JSON.stringify(order));
    }
  } catch {
    // Ignora erro
  }
}

const toggleRegistry = new Map<string, { isVisible: boolean; registeredAt: number }>();

function computePortalOwner(): string | null {
  const visible = Array.from(toggleRegistry.entries()).filter(([_, m]) => m.isVisible);
  if (visible.length > 0) {
    visible.sort((a, b) => b[1].registeredAt - a[1].registeredAt);
    return visible[0][0];
  }
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
  hiddenTaskIds: readInitialHiddenTasks(),
  collapsedProjectIds: readInitialCollapsedProjects(),
  hiddenProjectIds: readInitialHiddenProjects(),
  projectsOrder: readInitialProjectsOrder(),
  runDevStates: {},
  runBuildStates: {},
  exibindoArquivados: false,
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

  hideTask(taskId: string) {
    if (state.hiddenTaskIds.has(taskId)) return;
    const next = new Set(state.hiddenTaskIds);
    next.add(taskId);
    state = { ...state, hiddenTaskIds: next };
    persistHiddenTasks(next);
    notify();
  },

  unhideTask(taskId: string) {
    if (!state.hiddenTaskIds.has(taskId)) return;
    const next = new Set(state.hiddenTaskIds);
    next.delete(taskId);
    state = { ...state, hiddenTaskIds: next };
    persistHiddenTasks(next);
    notify();
  },

  isTaskHidden(taskId: string): boolean {
    return state.hiddenTaskIds.has(taskId);
  },

  clearHiddenTasks() {
    if (state.hiddenTaskIds.size === 0) return;
    const next = new Set<string>();
    state = { ...state, hiddenTaskIds: next };
    persistHiddenTasks(next);
    notify();
  },

  hideProject(projectId: string) {
    if (state.hiddenProjectIds.has(projectId)) return;
    const next = new Set(state.hiddenProjectIds);
    next.add(projectId);
    state = { ...state, hiddenProjectIds: next };
    persistHiddenProjects(next);
    notify();
  },

  unhideProject(projectId: string) {
    if (!state.hiddenProjectIds.has(projectId)) return;
    const next = new Set(state.hiddenProjectIds);
    next.delete(projectId);
    state = { ...state, hiddenProjectIds: next };
    persistHiddenProjects(next);
    notify();
  },

  isProjectHidden(projectId: string): boolean {
    return state.hiddenProjectIds.has(projectId);
  },

  clearHiddenProjects() {
    if (state.hiddenProjectIds.size === 0) return;
    const next = new Set<string>();
    state = { ...state, hiddenProjectIds: next };
    persistHiddenProjects(next);
    notify();
  },

  /**
   * Move um projeto uma posição para cima ou para baixo ENTRE OS VISÍVEIS.
   * O vizinho é o visível adjacente (conforme implementação do MaxCode).
   */
  moveProject(projectId: string, direcao: -1 | 1, visibleProjectIds: string[], allProjectIds: string[]) {
    const idx = visibleProjectIds.indexOf(projectId);
    const vizinhoId = visibleProjectIds[idx + direcao];
    if (idx === -1 || vizinhoId === undefined) return;

    // Constrói ordem completa baseada na ordem atual ou em allProjectIds
    const ordemAtual = state.projectsOrder.length > 0 ? [...state.projectsOrder] : [...allProjectIds];
    for (const pid of allProjectIds) {
      if (!ordemAtual.includes(pid)) {
        ordemAtual.push(pid);
      }
    }

    const posDe = ordemAtual.indexOf(projectId);
    const posPara = ordemAtual.indexOf(vizinhoId);
    if (posDe === -1 || posPara === -1) return;

    ordemAtual[posDe] = vizinhoId;
    ordemAtual[posPara] = projectId;

    state = { ...state, projectsOrder: ordemAtual };
    persistProjectsOrder(ordemAtual);
    notify();
  },

  setProjectsOrder(order: string[]) {
    state = { ...state, projectsOrder: order };
    persistProjectsOrder(order);
    notify();
  },

  toggleRunDev(projectId: string) {
    const current = state.runDevStates[projectId] ?? "parado";
    const nextStatus: TaskRunStatus = current === "rodando" ? "parado" : "rodando";
    state = {
      ...state,
      runDevStates: {
        ...state.runDevStates,
        [projectId]: nextStatus,
      },
    };
    notify();
  },

  setRunDevStatus(projectId: string, status: TaskRunStatus) {
    state = {
      ...state,
      runDevStates: {
        ...state.runDevStates,
        [projectId]: status,
      },
    };
    notify();
  },

  toggleRunBuild(projectId: string) {
    const current = state.runBuildStates[projectId] ?? "parado";
    const nextStatus: TaskRunStatus = current === "rodando" ? "parado" : "rodando";
    state = {
      ...state,
      runBuildStates: {
        ...state.runBuildStates,
        [projectId]: nextStatus,
      },
    };
    notify();
  },

  setRunBuildStatus(projectId: string, status: TaskRunStatus) {
    state = {
      ...state,
      runBuildStates: {
        ...state.runBuildStates,
        [projectId]: status,
      },
    };
    notify();
  },

  setAllTaskStatuses(
    statuses: Record<string, { status: TaskRunStatus; pid?: number; exitCode?: number | null }>
  ) {
    const nextDev = { ...state.runDevStates };
    const nextBuild = { ...state.runBuildStates };
    let changed = false;

    for (const [key, val] of Object.entries(statuses)) {
      const [projId, taskType] = key.split(":");
      if (!projId || !taskType) continue;

      if (taskType === "dev") {
        if (nextDev[projId] !== val.status) {
          nextDev[projId] = val.status;
          changed = true;
        }
      } else if (taskType === "build") {
        if (nextBuild[projId] !== val.status) {
          nextBuild[projId] = val.status;
          changed = true;
        }
      }
    }

    if (changed) {
      state = {
        ...state,
        runDevStates: nextDev,
        runBuildStates: nextBuild,
      };
      notify();
    }
  },

  setExibindoArquivados(exibindo: boolean) {
    if (state.exibindoArquivados === exibindo) return;
    state = { ...state, exibindoArquivados: exibindo };
    notify();
  },

  toggleExibindoArquivados() {
    sidebarStore.setExibindoArquivados(!state.exibindoArquivados);
  },

  toggleProjectCollapsed(projectId: string) {
    const next = new Set(state.collapsedProjectIds);
    if (next.has(projectId)) {
      next.delete(projectId);
    } else {
      next.add(projectId);
    }
    state = { ...state, collapsedProjectIds: next };
    persistCollapsedProjects(next);
    notify();
  },

  isProjectCollapsed(projectId: string): boolean {
    return state.collapsedProjectIds.has(projectId);
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
