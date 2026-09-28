/**
 * Motor reativo de tradução para Português do Brasil (pt-BR)
 * Suporta habilitação e desabilitação em tempo real com restauração instantânea do DOM.
 */

import { TRANSLATIONS, REGEX_RULES } from "./dictionary.js";

const STORAGE_KEY = "paperclip_translation_enabled";
const STYLE_ID = "paperclip-pt-br-style";

const exactTranslations = new Map<string, string>(Object.entries(TRANSLATIONS));
const regexRules = REGEX_RULES.map((rule) => ({
  regex: new RegExp(rule.pattern, rule.flags),
  replacement: rule.replacement,
}));

const CODE_TAGS = new Set(["CODE", "PRE"]);
const SCRIPT_STYLE_TAGS = new Set(["SCRIPT", "STYLE"]);

// Mapas fracos para rastrear o texto e atributos originais em inglês
const originalTextMap = new WeakMap<Node, { original: string; translated: string }>();
const originalAttrMap = new WeakMap<Element, Record<string, { original: string; translated: string }>>();

class TranslationEngine {
  private _enabled: boolean;
  private observer: MutationObserver | null = null;
  private scheduledNodes: Node[] = [];
  private isScheduled = false;
  private listeners = new Set<(enabled: boolean) => void>();
  private originalDocumentLang: string | null = null;

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

  // Verifica se o nó ou seu pai é um campo editável ou editor rico
  public isEditable(node: Node | null): boolean {
    if (!node || typeof document === "undefined") return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    if (!el) return false;

    // 1. Tags nativas
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

    // 2. ContentEditable nativo
    if (el.isContentEditable) return true;

    // 3. Editores ricos (Lexical, MDXEditor, CodeMirror, etc.)
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

  private translateString(str: string): string | null {
    if (!str || typeof str !== "string") return null;
    const trimmed = str.trim();
    if (!trimmed || trimmed.length < 1) return null;

    // 1. Busca exata no dicionário
    if (exactTranslations.has(trimmed)) {
      return str.replace(trimmed, exactTranslations.get(trimmed)!);
    }

    // 2. Busca insensível para palavras curtas
    const lower = trimmed.toLowerCase();
    for (const [k, v] of exactTranslations.entries()) {
      if (k.toLowerCase() === lower && trimmed.length < 35) {
        return str.replace(trimmed, v);
      }
    }

    // 3. Regras regex dinâmicas
    let processed = str;
    let matched = false;
    for (let i = 0; i < regexRules.length; i++) {
      const rule = regexRules[i];
      rule.regex.lastIndex = 0;
      if (rule.regex.test(processed)) {
        rule.regex.lastIndex = 0;
        processed = processed.replace(rule.regex, rule.replacement);
        matched = true;
      }
    }

    return matched ? processed : null;
  }

  private translateAttributes(el: Element) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

    const attrs = ["placeholder", "title", "aria-label"];
    let savedAttrs = originalAttrMap.get(el);

    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const val = el.getAttribute(attr);
      if (val) {
        if (!savedAttrs) {
          savedAttrs = {};
          originalAttrMap.set(el, savedAttrs);
        }
        const previous = savedAttrs[attr];
        if (previous?.translated === val) continue;
        const t = this.translateString(val);
        if (t && t !== val) {
          savedAttrs[attr] = { original: val, translated: t };
          el.setAttribute(attr, t);
        }
      }
    }

    // Apenas botões de input recebem tradução em value
    if (el.tagName === "INPUT") {
      const inputEl = el as HTMLInputElement;
      if (inputEl.type === "button" || inputEl.type === "submit") {
        const val = inputEl.getAttribute("value");
        if (val) {
          if (!savedAttrs) {
            savedAttrs = {};
            originalAttrMap.set(el, savedAttrs);
          }
          const previous = savedAttrs.value;
          if (previous?.translated === val) return;
          const t = this.translateString(val);
          if (t && t !== val) {
            savedAttrs.value = { original: val, translated: t };
            inputEl.setAttribute("value", t);
          }
        }
      }
    }
  }

  public walkAndTranslate(node: Node | null) {
    if (!node || !this._enabled) return;

    // Proteção total contra tradução de campos editáveis
    if (this.isEditable(node)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        this.translateAttributes(node as Element);
      }
      return;
    }

    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active && this.isEditable(active) && (node === active || (active.contains && active.contains(node)))) {
      return;
    }

    // Nós de texto
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && !SCRIPT_STYLE_TAGS.has(parent.tagName) && !CODE_TAGS.has(parent.tagName)) {
        const current = node.nodeValue || "";
        const previous = originalTextMap.get(node);
        if (previous?.translated === current) return;
        const translated = this.translateString(current);
        if (translated !== null && translated !== current) {
          originalTextMap.set(node, { original: current, translated });
          node.nodeValue = translated;
        }
      }
      return;
    }

    // Elementos da interface
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (SCRIPT_STYLE_TAGS.has(el.tagName)) return;

      this.translateAttributes(el);

      if (CODE_TAGS.has(el.tagName)) return;

      let child = el.firstChild;
      while (child) {
        this.walkAndTranslate(child);
        child = child.nextSibling;
      }
    }
  }

  public walkAndRestore(node: Node | null) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      if (originalTextMap.has(node)) {
        const saved = originalTextMap.get(node);
        if (saved && node.nodeValue === saved.translated) {
          node.nodeValue = saved.original;
        }
      }
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (originalAttrMap.has(el)) {
        const saved = originalAttrMap.get(el);
        if (saved) {
          for (const [attr, values] of Object.entries(saved)) {
            if (el.getAttribute(attr) === values.translated) el.setAttribute(attr, values.original);
          }
        }
      }

      let child = el.firstChild;
      while (child) {
        this.walkAndRestore(child);
        child = child.nextSibling;
      }
    }
  }

  private injectTypographyStyles() {
    if (typeof document === "undefined") return;
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        h1, h2, h3, h4,
        .uppercase, [class*="uppercase"] {
          text-transform: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    style.disabled = false;
  }

  private removeTypographyStyles() {
    if (typeof document === "undefined") return;
    const style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (style) {
      style.disabled = true;
    }
  }

  private flushQueue = () => {
    const nodes = this.scheduledNodes;
    this.scheduledNodes = [];
    this.isScheduled = false;
    for (let i = 0; i < nodes.length; i++) {
      this.walkAndTranslate(nodes[i]);
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
        } else if (m.type === "characterData") {
          if (!this.isEditable(m.target)) this.scheduledNodes.push(m.target);
        } else if (m.type === "attributes" && m.target instanceof Element) {
          if (!this.isEditable(m.target)) this.scheduledNodes.push(m.target);
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
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label", "value"],
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
    if (this.originalDocumentLang === null) {
      this.originalDocumentLang = document.documentElement.getAttribute("lang");
    }
    document.documentElement.lang = "pt-BR";
    this.injectTypographyStyles();
    this.walkAndTranslate(document.body);
    this.setupObserver();
  }

  public deactivate() {
    if (typeof document === "undefined") return;
    this.disconnectObserver();
    this.removeTypographyStyles();
    if (this.originalDocumentLang === null) document.documentElement.removeAttribute("lang");
    else document.documentElement.setAttribute("lang", this.originalDocumentLang);
    this.walkAndRestore(document.body);
  }

  public init() {
    if (typeof document === "undefined") return;
    if (this._enabled) {
      this.activate();
    }
  }
}

export const translationEngine = new TranslationEngine();

if (typeof window !== "undefined") {
  (window as unknown as { PaperclipTranslator: TranslationEngine }).PaperclipTranslator = translationEngine;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => translationEngine.init());
  } else {
    translationEngine.init();
  }
}
