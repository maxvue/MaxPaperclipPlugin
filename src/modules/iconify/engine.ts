/**
 * Motor de Renderização de Ícones Iconify para Paperclip.
 * Detecta anotações <i nome-do-icone [tamanho] [cor] > e substitui por SVGs embutidos.
 */

import { iconifyCache } from "./cache.js";

const STORAGE_KEY = "paperclip_iconify_enabled";
const ICON_REGEX = /(?:<i\s+|&lt;i\s+)((?:(?!<i|&lt;i)[^>])*?)\s*(?:\/?>|\/?&gt;)(?:<\/i>|&lt;\/i&gt;)?/gi;

const CODE_TAGS = new Set(["CODE", "PRE"]);
const SCRIPT_STYLE_TAGS = new Set(["SCRIPT", "STYLE"]);

interface ParsedIcon {
  raw: string;
  prefix: string;
  name: string;
  size: string;
  color: string;
  cacheKey: string;
}

const inFlight = new Map<string, Promise<string | null>>();
const originalSpanMap = new WeakMap<HTMLElement, string>();
const SAFE_SVG_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse",
  "defs", "clippath", "mask", "title",
]);
const SAFE_SVG_ATTRIBUTES = new Set([
  "viewbox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "fill-rule", "clip-rule", "d", "cx", "cy",
  "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "points", "transform",
  "opacity", "fill-opacity", "stroke-opacity", "id", "clip-path", "mask",
  "aria-hidden", "role", "focusable", "xmlns",
]);

function isSafeSvgAttribute(name: string, value: string): boolean {
  const normalizedName = name.toLowerCase();
  const normalizedValue = value.trim();
  return Boolean(
    SAFE_SVG_ATTRIBUTES.has(normalizedName) &&
    !normalizedName.startsWith("on") &&
    !/(?:javascript:|data:|https?:)/i.test(normalizedValue) &&
    (!normalizedValue.includes("url(") || /^url\(#[A-Za-z0-9_-]+\)$/.test(normalizedValue))
  );
}

export function sanitizeIconSvg(svg: string, size: string): string | null {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return null;
  const documentSvg = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (documentSvg.querySelector("parsererror")) return null;
  const root = documentSvg.documentElement;
  if (root.localName.toLowerCase() !== "svg") return null;
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (element !== root && !SAFE_SVG_TAGS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    if (!element.isConnected && element !== root) continue;
    for (const attribute of Array.from(element.attributes)) {
      if (!isSafeSvgAttribute(attribute.name, attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  root.setAttribute("width", size);
  root.setAttribute("height", size);
  root.setAttribute(
    "style",
    `display:inline-block;vertical-align:-0.15em;width:${size};height:${size}`,
  );
  return new XMLSerializer().serializeToString(root);
}

class IconifyEngine {
  private _enabled: boolean;
  private observer: MutationObserver | null = null;
  private scheduledNodes: Node[] = [];
  private isScheduled = false;
  private listeners = new Set<(enabled: boolean) => void>();

  constructor() {
    if (typeof window === "undefined") {
      this._enabled = true;
      return;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    this._enabled = stored !== "false";
  }

  public get isEnabled(): boolean {
    return this._enabled;
  }

  public subscribe(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this._enabled);
    }
  }

  public setEnabled(enabled: boolean) {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
    }

    if (enabled) {
      this.activate();
    } else {
      this.deactivate();
    }

    this.notify();
  }

  public toggle(): boolean {
    this.setEnabled(!this._enabled);
    return this._enabled;
  }

  /**
   * Analisa a string interna da tag e extrai nome, tamanho e cor.
   */
  public parseIconTag(raw: string, inner: string): ParsedIcon | null {
    const trimmed = inner
      .replace(/(?:\/?>|\/?&gt;)$/, "")
      .replace(/^(?:<i|&lt;i)/i, "")
      .trim();
    if (!trimmed) return null;

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const rawName = tokens[0];
    if (!rawName) return null;

    let size = "1em";
    let color = "currentColor";

    if (tokens.length >= 2) {
      const second = tokens[1];
      // Verifica se é numérico ou com unidade (ex: 26, 26em, 1.5em, 26px, 1.25rem, 100%)
      if (/^\d+(?:\.\d+)?(?:em|rem|px|%)?$/i.test(second)) {
        if (/^\d+(?:\.\d+)?$/i.test(second)) {
          // Número sem unidade: adota 'em' conforme solicitado pelo usuário
          size = `${second}em`;
        } else {
          // Unidade explícita
          size = second;
        }

        if (tokens.length >= 3) {
          color = tokens[2];
        }
      } else {
        // Se o segundo token for cor direta (ex: #336699, red, etc)
        color = second;
      }
    }

    if (!/^[a-z0-9][a-z0-9:_/-]*$/i.test(rawName)) return null;
    if (!/^(?:currentColor|none|#[0-9a-f]{3,8}|[a-z]{1,24}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\))$/i.test(color)) {
      color = "currentColor";
    }

    // Resolução de prefixo e nome do Iconify
    let prefix = "lucide";
    let name = rawName;

    if (rawName.includes(":")) {
      const parts = rawName.split(":");
      prefix = parts[0];
      name = parts[1];
    } else if (rawName.includes("/")) {
      const parts = rawName.split("/");
      prefix = parts[0];
      name = parts[1];
    } else if (rawName.includes("-") && !rawName.startsWith("icon-")) {
      const firstDash = rawName.indexOf("-");
      prefix = rawName.slice(0, firstDash);
      name = rawName.slice(firstDash + 1);
    }

    const cacheKey = `${prefix}:${name}:${size}:${color}`;

    return {
      raw,
      prefix,
      name,
      size,
      color,
      cacheKey,
    };
  }

  /**
   * Faz requisição à API do Iconify com cache e desduplicação de chamadas simultâneas.
   */
  public async fetchIconSvg(parsed: ParsedIcon): Promise<string | null> {
    const cached = iconifyCache.get(parsed.cacheKey);
    if (cached) {
      const sanitized = sanitizeIconSvg(cached, parsed.size);
      if (sanitized) return sanitized;
      iconifyCache.delete(parsed.cacheKey);
    }

    if (inFlight.has(parsed.cacheKey)) {
      return inFlight.get(parsed.cacheKey)!;
    }

    const promise = (async () => {
      try {
        const sizeParam = parsed.size.replace(/px$/i, "");
        const url = `https://api.iconify.design/${encodeURIComponent(parsed.prefix)}/${encodeURIComponent(parsed.name)}.svg?width=${encodeURIComponent(sizeParam)}&height=${encodeURIComponent(sizeParam)}&color=${encodeURIComponent(parsed.color)}`;

        const res = await fetch(url);
        if (!res.ok) {
          return null;
        }

        const rawSvg = await res.text();
        const svg = sanitizeIconSvg(rawSvg, parsed.size);
        if (!svg) {
          return null;
        }

        iconifyCache.set(parsed.cacheKey, svg);
        return svg;
      } catch (err) {
        console.warn(`[Iconify Plugin] Erro ao buscar ícone ${parsed.cacheKey}:`, err);
        return null;
      } finally {
        inFlight.delete(parsed.cacheKey);
      }
    })();

    inFlight.set(parsed.cacheKey, promise);
    return promise;
  }

  /**
   * Proteção total: nunca toca em campos de digitação do usuário.
   */
  public isEditable(node: Node | null): boolean {
    if (!node || typeof document === "undefined") return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    if (!el) return false;

    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;

    if (
      el.closest &&
      el.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"], ' +
          '.ProseMirror, .cm-editor, .monaco-editor, [data-lexical-editor], ' +
          '.paperclip-mdxeditor-content, [class*="mdxeditor"], [class*="contentEditable"]'
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Processa nós de texto procurando anotações <i ... >.
   */
  private processTextNode(textNode: Text) {
    const parent = textNode.parentElement;
    if (!parent) return;
    if (SCRIPT_STYLE_TAGS.has(parent.tagName) || CODE_TAGS.has(parent.tagName)) return;

    const text = textNode.nodeValue;
    if (!text || (!text.includes("<i") && !text.includes("&lt;i"))) return;

    // Reseta índice do regex
    ICON_REGEX.lastIndex = 0;
    const matches: Array<{ full: string; inner: string; index: number }> = [];
    let m: RegExpExecArray | null;

    while ((m = ICON_REGEX.exec(text)) !== null) {
      matches.push({
        full: m[0],
        inner: m[1],
        index: m.index,
      });
    }

    if (matches.length === 0) return;

    const frag = document.createDocumentFragment();
    let lastIdx = 0;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      // Texto antes do ícone
      if (match.index > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      }

      const parsed = this.parseIconTag(match.full, match.inner);
      if (parsed) {
        const span = document.createElement("span");
        span.className = "paperclip-iconify-host";
        span.setAttribute("data-iconify-raw", match.full);
        span.setAttribute("data-iconify-key", parsed.cacheKey);
        span.style.display = "inline-flex";
        span.style.alignItems = "center";
        span.style.verticalAlign = "middle";
        span.style.margin = "0 0.15em";
        span.style.width = parsed.size;
        span.style.height = parsed.size;
        span.style.minWidth = parsed.size;
        span.style.minHeight = parsed.size;
        originalSpanMap.set(span, match.full);

        void this.fetchIconSvg(parsed).then((svg) => {
          if (svg && span.isConnected) {
            span.innerHTML = svg;
          }
        });
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(match.full));
      }

      lastIdx = match.index + match.full.length;
    }

    // Texto remanescente após o último ícone
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    }

    parent.replaceChild(frag, textNode);
  }

  /**
   * Processa tags <i> já renderizadas no HTML que possam ter nomes de ícones.
   */
  private processElementNode(el: HTMLElement) {
    if (el.tagName === "I") {
      const attrNames = el.getAttributeNames();
      // Se houver atributos (ex: <i akar-icons:github-fill 2>), usa apenas os atributos como tokens do ícone
      // Se não houver atributos (ex: <i>akar-icons:github-fill 2</i>), usa o innerText
      let inner: string;
      if (attrNames.length > 0) {
        inner = attrNames.join(" ").trim();
      } else {
        inner = el.innerText.trim();
      }

      if (inner) {
        const parsed = this.parseIconTag(el.outerHTML, inner);
        if (parsed) {
          const span = document.createElement("span");
          span.className = "paperclip-iconify-host";
          span.setAttribute("data-iconify-raw", el.outerHTML);
          span.setAttribute("data-iconify-key", parsed.cacheKey);
          span.style.display = "inline-flex";
          span.style.alignItems = "center";
          span.style.verticalAlign = "middle";
          span.style.margin = "0 0.15em";
          span.style.width = parsed.size;
          span.style.height = parsed.size;
          span.style.minWidth = parsed.size;
          span.style.minHeight = parsed.size;
          originalSpanMap.set(span, el.outerHTML);

          void this.fetchIconSvg(parsed).then((svg) => {
            if (svg && span.isConnected) {
              span.innerHTML = svg;
            }
          });

          const parent = el.parentElement;
          if (parent) {
            // Se o elemento <i> engoliu texto subsequente não fechado, move os filhos para fora
            if (attrNames.length > 0 && el.childNodes.length > 0) {
              const frag = document.createDocumentFragment();
              while (el.firstChild) {
                frag.appendChild(el.firstChild);
              }
              parent.insertBefore(frag, el.nextSibling);
            }
            parent.replaceChild(span, el);
          }
          return;
        }
      }
    }

    let child = el.firstChild;
    while (child) {
      const next = child.nextSibling;
      this.walkAndTransform(child);
      child = next;
    }
  }

  public walkAndTransform(node: Node | null) {
    if (!node || !this._enabled) return;

    if (this.isEditable(node)) return;

    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active && this.isEditable(active) && (node === active || (active.contains && active.contains(node)))) {
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      this.processTextNode(node as Text);
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (SCRIPT_STYLE_TAGS.has(el.tagName) || CODE_TAGS.has(el.tagName)) return;
      if (el.classList && el.classList.contains("paperclip-iconify-host")) return;

      this.processElementNode(el);
    }
  }

  public walkAndRestore(node: Node | null) {
    if (!node || typeof document === "undefined") return;

    const hosts = Array.from(document.querySelectorAll<HTMLElement>(".paperclip-iconify-host"));
    for (const host of hosts) {
      const raw = host.getAttribute("data-iconify-raw") || originalSpanMap.get(host);
      if (raw && host.parentElement) {
        host.parentElement.replaceChild(document.createTextNode(raw), host);
      }
    }
  }

  private flushQueue = () => {
    const nodes = this.scheduledNodes;
    this.scheduledNodes = [];
    this.isScheduled = false;
    for (let i = 0; i < nodes.length; i++) {
      this.walkAndTransform(nodes[i]);
    }
  };

  private setupObserver() {
    if (typeof document === "undefined" || this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      if (!this._enabled) return;

      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === "childList") {
          if (this.isEditable(m.target)) continue;

          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (!this.isEditable(n)) {
              this.scheduledNodes.push(n);
            }
          }
        }
      }

      if (!this.isScheduled && this.scheduledNodes.length > 0) {
        this.isScheduled = true;
        requestAnimationFrame(this.flushQueue);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private disconnectObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.scheduledNodes = [];
    this.isScheduled = false;
  }

  public activate() {
    if (typeof document === "undefined") return;
    this.walkAndTransform(document.body);
    this.setupObserver();
  }

  public deactivate() {
    if (typeof document === "undefined") return;
    this.disconnectObserver();
    this.walkAndRestore(document.body);
  }

  public init() {
    if (typeof document === "undefined") return;
    if (this._enabled) {
      this.activate();
    }
  }
}

export const iconifyEngine = new IconifyEngine();

if (typeof window !== "undefined") {
  (window as unknown as { PaperclipIconify: IconifyEngine }).PaperclipIconify = iconifyEngine;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => iconifyEngine.init());
  } else {
    iconifyEngine.init();
  }
}
