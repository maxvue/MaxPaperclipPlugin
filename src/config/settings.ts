/**
 * Gerenciador de Configurações e Toggles do MaxPaperclipPlugin
 * Permite ativar ou desativar módulos individualmente com persistência em localStorage.
 * Todos os módulos vêm habilitados por padrão.
 */

export interface MaxPluginSettings {
  autosave: boolean;
  translator: boolean;
  iconify: boolean;
  tasks: boolean;
  capabilities: boolean;
}

const STORAGE_KEY = "max_paperclip_plugin_settings";

const DEFAULT_SETTINGS: MaxPluginSettings = {
  autosave: true,
  translator: true,
  iconify: true,
  tasks: true,
  capabilities: true,
};

type SettingsListener = (settings: MaxPluginSettings) => void;
const listeners = new Set<SettingsListener>();

let memorySettings: MaxPluginSettings | null = null;

export function getSettings(): MaxPluginSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return memorySettings ? { ...memorySettings } : { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      autosave: typeof parsed.autosave === "boolean" ? parsed.autosave : DEFAULT_SETTINGS.autosave,
      translator: typeof parsed.translator === "boolean" ? parsed.translator : DEFAULT_SETTINGS.translator,
      iconify: typeof parsed.iconify === "boolean" ? parsed.iconify : DEFAULT_SETTINGS.iconify,
      tasks: typeof parsed.tasks === "boolean" ? parsed.tasks : DEFAULT_SETTINGS.tasks,
      capabilities: typeof parsed.capabilities === "boolean" ? parsed.capabilities : DEFAULT_SETTINGS.capabilities,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateSetting<K extends keyof MaxPluginSettings>(key: K, value: boolean): MaxPluginSettings {
  const current = getSettings();
  const next = { ...current, [key]: value };
  memorySettings = next;

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("[MaxPaperclipPlugin] Falha ao salvar configuração:", err);
    }
  }
  for (const listener of listeners) {
    try {
      listener(next);
    } catch (err) {
      console.error("[MaxPaperclipPlugin] Erro no listener de configurações:", err);
    }
  }
  return next;
}

export function subscribeSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  listener(getSettings());
  return () => {
    listeners.delete(listener);
  };
}
