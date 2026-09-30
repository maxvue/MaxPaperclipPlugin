/**
 * Cache duplo para ícones do Iconify:
 * 1. Memória (Map) para acesso síncrono e ultra-rápido durante mutações do DOM.
 * 2. LocalStorage para persistência entre sessões e recarregamentos.
 */

const STORAGE_KEY = "paperclip_iconify_cache";
const MAX_CACHE_ENTRIES = 200;
const MAX_CACHE_BYTES = 1024 * 1024;

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
        this.enforceLimits();
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

  private enforceLimits() {
    let totalBytes = 0;
    for (const [key, value] of this.memCache) {
      totalBytes += key.length + value.length;
    }
    while (this.memCache.size > MAX_CACHE_ENTRIES || totalBytes > MAX_CACHE_BYTES) {
      const oldest = this.memCache.entries().next().value as [string, string] | undefined;
      if (!oldest) break;
      this.memCache.delete(oldest[0]);
      totalBytes -= oldest[0].length + oldest[1].length;
    }
  }

  public get(key: string): string | null {
    return this.memCache.get(key) ?? null;
  }

  public has(key: string): boolean {
    return this.memCache.has(key);
  }

  public set(key: string, svg: string): void {
    if (!svg || typeof svg !== "string") return;
    this.memCache.delete(key);
    this.memCache.set(key, svg);
    this.enforceLimits();
    this.scheduleSave();
  }

  public delete(key: string): void {
    this.memCache.delete(key);
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
