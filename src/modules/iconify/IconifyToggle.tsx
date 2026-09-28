import React, { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { iconifyEngine } from "./engine.js";
import { iconifyCache } from "./cache.js";
import { getSettings, subscribeSettings } from "../../config/settings.js";

interface IconifyToggleProps {
  context?: {
    companyId?: string | null;
    companyPrefix?: string | null;
  };
}

export function IconifyToggle({ context }: IconifyToggleProps) {
  const [enabled, setEnabled] = useState(() => iconifyEngine.isEnabled);
  const [moduleEnabled, setModuleEnabled] = useState(() => getSettings().iconify);

  useEffect(() => {
    const unsubEngine = iconifyEngine.subscribe((next) => {
      setEnabled(next);
    });
    const unsubSettings = subscribeSettings((settings) => {
      setModuleEnabled(settings.iconify);
      if (!settings.iconify && iconifyEngine.isEnabled) {
        iconifyEngine.setEnabled(false);
      }
    });
    return () => {
      unsubEngine();
      unsubSettings();
    };
  }, []);

  if (!moduleEnabled) return null;

  const title = enabled
    ? `Desativar ícones Iconify (${iconifyCache.size} em cache)`
    : "Ativar ícones Iconify (<i icone >)";

  return (
    <button
      type="button"
      onClick={() => iconifyEngine.toggle()}
      className={`inline-flex items-center justify-center h-8 px-2.5 rounded-md text-xs font-medium transition-colors border ${
        enabled
          ? "bg-accent text-accent-foreground border-border/80 shadow-xs"
          : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40 border-transparent"
      }`}
      aria-label={title}
      title={title}
    >
      <Sparkles className={`w-4 h-4 mr-1.5 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
      <span className="font-medium">Ícones</span>
    </button>
  );
}
