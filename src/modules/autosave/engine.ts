/**
 * Motor de Auto-Save do MaxPaperclipPlugin
 * Gerencia o ciclo de vida de salvamento automático com debounce de 1000ms,
 * máquina de estados visual e preservação contínua de foco e cursor do usuário.
 * 
 * Estados:
 * - 'idle': Azul (aguardando digitação)
 * - 'in_debounce': Laranja (digitado, aguardando 1s para salvar)
 * - 'saved': Verde (salvo, permanece por 2s sem digitação antes de voltar a 'idle')
 */

import { getSettings, subscribeSettings } from "../../config/settings.js";

export type AutoSaveStatus = "idle" | "in_debounce" | "requested" | "saved" | "error";

type Listener = (status: AutoSaveStatus) => void;
type DraftCommitResult = "confirmed" | "pending" | "none";

const PERSISTENCE_TIMEOUT_MS = 10_000;

interface FocusTargetSnapshot {
  element: HTMLElement;
  tag: string;
  type: string | null;
  name: string | null;
  placeholder: string | null;
  id: string | null;
  className: string;
  isContentEditable: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  selectionDirection: "forward" | "backward" | "none" | null;
  savedRange: Range | null;
  value: string | null;
  markerId: string;
  timestamp: number;
}

class AutoSaveEngine {
  private status: AutoSaveStatus = "idle";
  private listeners: Set<Listener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private saveGeneration = 0;

  // Snapshot do elemento atualmente focado e cursor
  private currentFocusSnapshot: FocusTargetSnapshot | null = null;
  private activeGuardCleanup: (() => void) | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      this.init();
    }
  }

  public get currentStatus(): AutoSaveStatus {
    return this.status;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(newStatus: AutoSaveStatus) {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.listeners) {
      try {
        listener(newStatus);
      } catch (err) {
        console.error("[AutoSave] Erro no listener:", err);
      }
    }
  }

  /**
   * Verifica se a rota atual é elegível para Auto-save:
   * - /:prefix/agents/:agentId/* (EXCETO instruções / instructions)
   * - /:prefix/projects/:projectId/*
   */
  public isEligibleRoute(pathname: string = typeof window !== "undefined" ? window.location.pathname : ""): boolean {
    if (!pathname) return false;
    if (!getSettings().autosave) return false;

    // 1. Exclui expressamente a aba de instruções de agente
    if (pathname.includes("/instructions")) {
      return false;
    }

    // 2. Rota de agentes: /:prefix/agents/:agentId ou /:prefix/agents/:agentId/:tab
    const agentMatch = pathname.match(/^\/[^/]+\/agents\/([^/]+)(?:\/([^/]+))?/);
    if (agentMatch) {
      const tab = agentMatch[2];
      if (tab === "instructions") {
        return false;
      }
      return true;
    }

    // 3. Rota de projetos: /:prefix/projects/:projectId
    const projectMatch = pathname.match(/^\/[^/]+\/projects\/([^/]+)/);
    if (projectMatch) {
      return true;
    }

    return false;
  }

  public isEditableElement(el: HTMLElement | null): boolean {
    if (!el) return false;

    // Se estiver explicitamente dentro de um editor de instruções, ignora
    if (
      el.closest(".cm-editor") ||
      el.closest("[data-instructions-editor]") ||
      el.closest('[data-testid="instructions-editor"]')
    ) {
      return false;
    }

    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el as HTMLInputElement).type?.toLowerCase();
      if (type === "button" || type === "submit" || type === "reset" || type === "checkbox" || type === "radio") {
        return false;
      }
      return true;
    }

    if (tag === "textarea" || tag === "select") {
      return true;
    }

    if (el.isContentEditable) {
      return true;
    }

    return false;
  }

  /**
   * Captura o estado atual de foco e seleção do elemento ativo
   */
  private updateFocusSnapshot = () => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.isEditableElement(active)) {
      return;
    }

    let markerId = active.getAttribute("data-autosave-target");
    if (!markerId) {
      markerId = `ast-${Math.random().toString(36).slice(2, 9)}`;
      active.setAttribute("data-autosave-target", markerId);
    }

    const isInputOrTextarea = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    const isContentEditable = active.isContentEditable;
    const selectionStart = isInputOrTextarea ? (active as HTMLInputElement).selectionStart : null;
    const selectionEnd = isInputOrTextarea ? (active as HTMLInputElement).selectionEnd : null;
    const selectionDirection = isInputOrTextarea ? (active as HTMLInputElement).selectionDirection : null;
    const value = isInputOrTextarea ? (active as HTMLInputElement).value : active.textContent;

    let savedRange: Range | null = null;
    if (isContentEditable && typeof window !== "undefined") {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        try {
          savedRange = sel.getRangeAt(0).cloneRange();
        } catch {}
      }
    }

    this.currentFocusSnapshot = {
      element: active,
      tag: active.tagName.toLowerCase(),
      type: (active as HTMLInputElement).type || null,
      name: active.getAttribute("name"),
      placeholder: active.getAttribute("placeholder"),
      id: active.getAttribute("id"),
      className: active.className,
      isContentEditable,
      selectionStart,
      selectionEnd,
      selectionDirection,
      savedRange,
      value,
      markerId,
      timestamp: Date.now(),
    };
  };

  private handleUserTyping = (event: Event) => {
    if (!this.isEligibleRoute()) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!this.isEditableElement(target)) {
      return;
    }

    this.updateFocusSnapshot();
    this.saveGeneration += 1;

    // Se houver um timer de 2s ativo no verde, cancela imediatamente
    if (this.savedTimer) {
      clearTimeout(this.savedTimer);
      this.savedTimer = null;
    }

    // Se já havia um debounce aguardando, reinicia
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Transiciona para Laranja ('in_debounce')
    this.setStatus("in_debounce");

    // Agenda o salvamento para após 1000ms sem digitação
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.executeSave();
    }, 1000);
  };

  /**
   * Busca recursivamente uma propriedade no React Fiber do elemento
   */
  private findFiberProp(el: HTMLElement, propName: string): any {
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!fiberKey) return null;
    let fiber = (el as any)[fiberKey];
    let depth = 0;
    while (fiber && depth < 8) {
      if (fiber.memoizedProps && typeof fiber.memoizedProps[propName] !== "undefined") {
        return fiber.memoizedProps[propName];
      }
      fiber = fiber.return;
      depth++;
    }
    return null;
  }

  /**
   * Confirma o rascunho de forma não-destrutiva sem forçar perda de foco
   */
  private async commitActiveDraft(snapshot: FocusTargetSnapshot | null): Promise<DraftCommitResult> {
    if (!snapshot) return "none";
    const target = this.findSnapshotTarget(snapshot);
    if (!target || !this.isEditableElement(target)) {
      return "none";
    }

    const isInputOrTextarea = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const value = isInputOrTextarea ? target.value : target.textContent || "";

    // 1. Caso InlineEditor: invoca onSave diretamente sem disparar blur (que destruiria o input)
    const onSave = this.findFiberProp(target, "onSave");
    if (typeof onSave === "function") {
      try {
        const completed = await this.waitForPersistence(onSave(value));
        return completed ? "confirmed" : "pending";
      } catch {
        // Segue fallback
      }
    }

    // 2. Caso DraftInput: invoca onCommit diretamente sem acionar blur
    const onCommit = this.findFiberProp(target, "onCommit");
    const immediate = this.findFiberProp(target, "immediate");
    if (typeof onCommit === "function" && !immediate) {
      try {
        const completed = await this.waitForPersistence(onCommit(value));
        return completed ? "confirmed" : "pending";
      } catch {
        // Segue fallback
      }
    }
    return "none";
  }

  private async waitForPersistence(result: unknown): Promise<boolean> {
    if (!result || typeof (result as PromiseLike<unknown>).then !== "function") return true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        Promise.resolve(result).then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), PERSISTENCE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Localiza o elemento alvo correspondente ao snapshot, mesmo após re-render ou remontagem de rotas
   */
  private findSnapshotTarget(snapshot: FocusTargetSnapshot): HTMLElement | null {
    if (snapshot.element && snapshot.element.isConnected) {
      return snapshot.element;
    }

    // 1. Busca por markerId
    if (snapshot.markerId) {
      const byMarker = document.querySelector<HTMLElement>(`[data-autosave-target="${snapshot.markerId}"]`);
      if (byMarker && byMarker.isConnected) return byMarker;
    }

    // 2. Busca por name
    if (snapshot.name) {
      const byName = document.querySelector<HTMLElement>(`${snapshot.tag}[name="${CSS.escape(snapshot.name)}"]`);
      if (byName && byName.isConnected) return byName;
    }

    // 3. Busca por id
    if (snapshot.id) {
      const byId = document.getElementById(snapshot.id);
      if (byId && byId.isConnected) return byId;
    }

    // 4. Busca por placeholder
    if (snapshot.placeholder) {
      const byPlaceholder = document.querySelector<HTMLElement>(`${snapshot.tag}[placeholder="${CSS.escape(snapshot.placeholder)}"]`);
      if (byPlaceholder && byPlaceholder.isConnected) return byPlaceholder;
    }

    // 5. Fallback por tag e classe similar
    if (snapshot.className) {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(snapshot.tag));
      const match = candidates.find((c) => c.className === snapshot.className);
      if (match) return match;
    }

    return null;
  }

  /**
   * Inicia a guarda de foco e posição de cursor durante e após o salvamento
   */
  private startFocusGuard(snapshot: FocusTargetSnapshot, durationMs = 2500) {
    if (this.activeGuardCleanup) {
      this.activeGuardCleanup();
      this.activeGuardCleanup = null;
    }

    let isGuarding = true;

    const restore = () => {
      if (!isGuarding) return;
      const target = this.findSnapshotTarget(snapshot);
      if (!target) return;

      // Restaura o foco se o elemento perdeu foco
      if (document.activeElement !== target) {
        try {
          target.focus({ preventScroll: true });
        } catch {}
      }

      // Restaura e protege o cursor se for input ou textarea
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
          const currentStart = target.selectionStart;
          const currentEnd = target.selectionEnd;
          if (currentStart !== snapshot.selectionStart || currentEnd !== snapshot.selectionEnd) {
            try {
              target.setSelectionRange(
                snapshot.selectionStart,
                snapshot.selectionEnd,
                snapshot.selectionDirection || "forward",
              );
            } catch {}
          }
        }
      } else if (snapshot.isContentEditable && snapshot.savedRange && typeof window !== "undefined") {
        const sel = window.getSelection();
        if (sel) {
          try {
            sel.removeAllRanges();
            sel.addRange(snapshot.savedRange);
          } catch {}
        }
      }
    };

    // Observa mutações no DOM para restaurar imediatamente caso o elemento seja remontado
    const observer = new MutationObserver(() => {
      restore();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    restore();

    const cleanup = () => {
      isGuarding = false;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("pointerdown", abortOnUserNavigation, true);
      window.removeEventListener("keydown", abortOnUserNavigation, true);
      if (this.activeGuardCleanup === cleanup) {
        this.activeGuardCleanup = null;
      }
    };

    const abortOnUserNavigation = (event: Event) => {
      const keyboardEvent = event instanceof KeyboardEvent ? event : null;
      if (event.type === "pointerdown" || keyboardEvent?.key === "Tab") cleanup();
    };
    window.addEventListener("pointerdown", abortOnUserNavigation, true);
    window.addEventListener("keydown", abortOnUserNavigation, true);
    const timer = setTimeout(cleanup, durationMs);

    this.activeGuardCleanup = cleanup;
  }

  /**
   * Localiza e aciona o botão de salvar alterações no rodapé do Agente
   */
  private triggerScopedSave(snapshot: FocusTargetSnapshot): boolean {
    const target = this.findSnapshotTarget(snapshot);
    const form = target?.closest("form");
    if (!form) return false;
    const buttons = Array.from(
      form.querySelectorAll<HTMLButtonElement>(
        'button[type="submit"], button[data-testid*="save"], button[data-testid*="Save"]',
      ),
    );
    for (const btn of buttons) {
      const text = (btn.textContent || "").trim().toLowerCase();
      if (
        text.includes("save changes") ||
        text.includes("salvar alterações") ||
        text.includes("salvar") ||
        text.includes("save")
      ) {
        if (!btn.disabled && !text.includes("saving") && !text.includes("salvando")) {
          btn.click();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Executa o processo de salvamento preservando foco e cursor
   */
  public executeSave() {
    if (!this.isEligibleRoute()) {
      this.setStatus("idle");
      return;
    }

    // 1. Atualiza e captura o snapshot do foco antes do salvamento
    this.updateFocusSnapshot();
    const snapshot = this.currentFocusSnapshot;
    const generation = ++this.saveGeneration;

    // 2. Se houver elemento focado, ativa a guarda de foco e cursor contínua
    if (snapshot) {
      this.startFocusGuard(snapshot, 2500);
    }

    // 3. Aguarda o callback de persistência quando ele expõe uma Promise.
    setTimeout(() => void this.finishSave(snapshot, generation), 60);
  }

  private async finishSave(snapshot: FocusTargetSnapshot | null, generation: number): Promise<void> {
    const draftCommit = await this.commitActiveDraft(snapshot);
    if (generation !== this.saveGeneration) return;
    const saveRequested = draftCommit === "none" && snapshot
      ? this.triggerScopedSave(snapshot)
      : false;

    // Um clique apenas solicita a gravação; somente callbacks concluídos confirmam sucesso.
    this.setStatus(
      draftCommit === "confirmed"
        ? "saved"
        : draftCommit === "pending" || saveRequested
          ? "requested"
          : "error",
    );

    // Retorna ao estado ocioso após exibir o resultado.
    if (this.savedTimer) {
      clearTimeout(this.savedTimer);
    }
    this.savedTimer = setTimeout(() => {
      this.savedTimer = null;
      if (
        generation === this.saveGeneration &&
        (this.status === "saved" || this.status === "requested" || this.status === "error")
      ) {
        this.setStatus("idle"); // Volta para o Azul
      }
    }, 2000);
  }

  private handleRouteChange = () => {
    if (!this.isEligibleRoute()) {
      this.saveGeneration += 1;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      if (this.savedTimer) {
        clearTimeout(this.savedTimer);
        this.savedTimer = null;
      }
      if (this.activeGuardCleanup) {
        this.activeGuardCleanup();
        this.activeGuardCleanup = null;
      }
      this.setStatus("idle");
    }
  };

  private init() {
    if (this.initialized) return;
    this.initialized = true;

    // Rastreia foco e cursor continuamente
    window.addEventListener("focusin", this.updateFocusSnapshot, true);
    window.addEventListener("click", this.updateFocusSnapshot, true);
    window.addEventListener("keyup", this.updateFocusSnapshot, true);
    window.addEventListener("input", this.handleUserTyping, true);
    window.addEventListener("change", this.handleUserTyping, true);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Backspace" || e.key === "Delete") {
        this.handleUserTyping(e);
      } else {
        setTimeout(this.updateFocusSnapshot, 0);
      }
    }, true);

    document.addEventListener("selectionchange", () => {
      // Atualiza o snapshot se o usuário moveu o cursor enquanto focado
      if (document.activeElement && this.isEditableElement(document.activeElement as HTMLElement)) {
        this.updateFocusSnapshot();
      }
    });

    window.addEventListener("popstate", this.handleRouteChange);
    window.addEventListener("pushstate", this.handleRouteChange);

    subscribeSettings((settings) => {
      if (!settings.autosave) {
        this.saveGeneration += 1;
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        if (this.savedTimer) {
          clearTimeout(this.savedTimer);
          this.savedTimer = null;
        }
        if (this.activeGuardCleanup) {
          this.activeGuardCleanup();
          this.activeGuardCleanup = null;
        }
        this.setStatus("idle");
      }
    });
  }
}

export const autoSaveEngine = new AutoSaveEngine();

/**
 * Função utilitária para testar e verificar se uma URL ou pathname é elegível para Auto-save
 */
export function shouldEnableAutoSaveForUrl(urlOrPath: string): boolean {
  let pathname = urlOrPath;
  try {
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
      const parsed = new URL(urlOrPath);
      pathname = parsed.pathname;
    }
  } catch {
    pathname = urlOrPath;
  }
  return autoSaveEngine.isEligibleRoute(pathname);
}
