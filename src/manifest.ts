import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "max.paperclip-plugin";
export const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "MaxPaperclipPlugin",
  description:
    "Plugin unificado oficial para Paperclip: Auto-save em tempo real, Tradutor pt-BR, Ícones dinâmicos Iconify, Painel Lateral de Tarefas e Editor de Capacidades.",
  author: "John Attas",
  categories: ["ui", "automation"],
  capabilities: [
    "issues.read",
    "projects.read",
    "ui.action.register",
    "ui.detailTab.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "globalToolbarButton",
        id: "autosave-status-btn",
        displayName: "Status do Auto-save",
        exportName: "AutoSaveStatusButton",
        order: 49,
      },
      {
        type: "globalToolbarButton",
        id: "translator-toggle-btn",
        displayName: "Tradutor Português (pt-BR)",
        exportName: "TranslatorToggle",
        order: 50,
      },
      {
        type: "globalToolbarButton",
        id: "iconify-toggle-btn",
        displayName: "Alternador de Ícones Iconify",
        exportName: "IconifyToggle",
        order: 51,
      },
      {
        type: "globalToolbarButton",
        id: "task-sidebar-toggle-btn",
        displayName: "Monitor de Tarefas (Barra Superior e Lateral)",
        exportName: "TaskSidebarToggle",
        order: 52,
      },
      {
        type: "taskDetailView",
        id: "agent-capabilities-editor-panel",
        displayName: "Capacidades",
        exportName: "AgentCapabilitiesPanel",
        entityTypes: ["agent"],
        order: 90,
      },
    ],
  },
};

export default manifest;
