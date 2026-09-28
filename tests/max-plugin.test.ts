import { describe, it, expect, beforeEach } from "vitest";
import manifest, { PLUGIN_ID, PLUGIN_VERSION } from "../src/manifest.js";
import { getSettings, updateSetting, subscribeSettings, DEFAULT_SETTINGS } from "../src/config/settings.js";
import { shouldEnableAutoSaveForUrl } from "../src/modules/autosave/engine.js";
import { TRANSLATIONS } from "../src/modules/translator/dictionary.js";

describe("MaxPaperclipPlugin - Manifesto e Configurações", () => {
  it("deve conter metadados e identificadores corretos", () => {
    expect(PLUGIN_ID).toBe("max.paperclip-plugin");
    expect(PLUGIN_VERSION).toBe("0.1.0");
    expect(manifest.id).toBe("max.paperclip-plugin");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.displayName).toBe("MaxPaperclipPlugin");
  });

  it("deve declarar todas as capabilities necessárias para os módulos", () => {
    const requiredCaps = [
      "issues.read",
      "projects.read",
      "ui.action.register",
      "ui.detailTab.register",
    ];
    for (const cap of requiredCaps) {
      expect(manifest.capabilities).toContain(cap);
    }
  });

  it("deve registrar todos os 5 slots de UI nos locais e ordens corretas", () => {
    const slots = manifest.ui?.slots ?? [];
    expect(slots).toHaveLength(5);

    const autosaveSlot = slots.find((s) => s.id === "autosave-status-btn");
    expect(autosaveSlot).toBeDefined();
    expect(autosaveSlot?.type).toBe("globalToolbarButton");
    expect(autosaveSlot?.order).toBe(49);
    expect(autosaveSlot?.exportName).toBe("AutoSaveStatusButton");

    const translatorSlot = slots.find((s) => s.id === "translator-toggle-btn");
    expect(translatorSlot).toBeDefined();
    expect(translatorSlot?.type).toBe("globalToolbarButton");
    expect(translatorSlot?.order).toBe(50);
    expect(translatorSlot?.exportName).toBe("TranslatorToggle");

    const iconifySlot = slots.find((s) => s.id === "iconify-toggle-btn");
    expect(iconifySlot).toBeDefined();
    expect(iconifySlot?.type).toBe("globalToolbarButton");
    expect(iconifySlot?.order).toBe(51);
    expect(iconifySlot?.exportName).toBe("IconifyToggle");

    const taskSidebarSlot = slots.find((s) => s.id === "task-sidebar-toggle-btn");
    expect(taskSidebarSlot).toBeDefined();
    expect(taskSidebarSlot?.type).toBe("globalToolbarButton");
    expect(taskSidebarSlot?.order).toBe(52);
    expect(taskSidebarSlot?.exportName).toBe("TaskSidebarToggle");

    const capabilitiesSlot = slots.find((s) => s.id === "agent-capabilities-editor-panel");
    expect(capabilitiesSlot).toBeDefined();
    expect(capabilitiesSlot?.type).toBe("taskDetailView");
    expect(capabilitiesSlot?.order).toBe(90);
    expect(capabilitiesSlot?.exportName).toBe("AgentCapabilitiesPanel");
    expect(capabilitiesSlot?.entityTypes).toContain("agent");
  });
});

describe("MaxPaperclipPlugin - Gerenciador de Configurações Modulares", () => {
  beforeEach(() => {
    // Reseta localStorage simulado
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
  });

  it("deve ter todas as features habilitadas por padrão", () => {
    const settings = getSettings();
    expect(settings.autosave).toBe(true);
    expect(settings.translator).toBe(true);
    expect(settings.iconify).toBe(true);
    expect(settings.tasks).toBe(true);
    expect(settings.capabilities).toBe(true);
  });

  it("deve permitir alternar o estado de um módulo e notificar observadores", () => {
    let notified = false;
    const unsubscribe = subscribeSettings((settings) => {
      if (settings.autosave === false) {
        notified = true;
      }
    });

    const updated = updateSetting("autosave", false);
    expect(updated.autosave).toBe(false);
    expect(getSettings().autosave).toBe(false);
    expect(notified).toBe(true);

    unsubscribe();
    updateSetting("autosave", true);
  });
});

describe("MaxPaperclipPlugin - Regras do Motor de Auto-Save", () => {
  it("deve ativar auto-save para rotas de agentes e projetos suportadas", () => {
    expect(shouldEnableAutoSaveForUrl("http://localhost:3100/ENG/agents/meu-agente/config")).toBe(true);
    expect(shouldEnableAutoSaveForUrl("http://localhost:3100/ENG/projects/meu-projeto/detalhes")).toBe(true);
    expect(shouldEnableAutoSaveForUrl("/ENG/agents/agente-x/perfil")).toBe(true);
  });

  it("não deve ativar auto-save para páginas fora do escopo ou instruções", () => {
    expect(shouldEnableAutoSaveForUrl("http://localhost:3100/ENG/agents/meu-agente/instructions")).toBe(false);
    expect(shouldEnableAutoSaveForUrl("http://localhost:3100/ENG/dashboard")).toBe(false);
    expect(shouldEnableAutoSaveForUrl("http://localhost:3100/settings")).toBe(false);
  });
});

describe("MaxPaperclipPlugin - Dicionário do Tradutor PT-BR", () => {
  it("deve conter traduções cruciais da interface", () => {
    expect(TRANSLATIONS).toBeDefined();
    expect(Object.keys(TRANSLATIONS).length).toBeGreaterThan(10);
  });
});
