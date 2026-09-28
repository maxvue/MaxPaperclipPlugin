/**
 * Cache duplo para ícones do Iconify:
 * 1. Memória (Map) para acesso síncrono e ultra-rápido durante mutações do DOM.
 * 2. LocalStorage para persistência entre sessões e recarregamentos.
 */

const STORAGE_KEY = "paperclip_iconify_cache";

class IconifyCache {
  private memCache = new Map<string, string>();
  private saveTimeout: number | null = null;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      const data = window.localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") {
            // Se for entrada antiga com valor em px residual (ex: :2px:, :26px:), ignora
            if (/\b\d+px\b/i.test(k)) {
              continue;
            }
            this.memCache.set(k, v);
          }
        }
      }
    } catch (e) {
      console.warn("[Iconify Plugin] Falha ao carregar cache do localStorage:", e);
    }
  }

  private scheduleSave() {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (this.saveTimeout !== null) return;

    this.saveTimeout = window.setTimeout(() => {
      this.saveTimeout = null;
      try {
        const obj: Record<string, string> = {};
        for (const [k, v] of this.memCache.entries()) {
          obj[k] = v;
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch (e) {
        console.warn("[Iconify Plugin] Falha ao salvar cache no localStorage:", e);
      }
    }, 500);
  }

  public get(key: string): string | null {
    return this.memCache.get(key) ?? null;
  }

  public has(key: string): boolean {
    return this.memCache.has(key);
  }

  public set(key: string, svg: string): void {
    if (!svg || typeof svg !== "string") return;
    this.memCache.set(key, svg);
    this.scheduleSave();
  }

  public get count(): number {
    return this.memCache.size;
  }

  public get size(): number {
    return this.memCache.size;
  }

  public clear(): void {
    this.memCache.clear();
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }
}

export const iconifyCache = new IconifyCache();
