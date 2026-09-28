import React, { useState, useEffect } from "react";
import { Languages } from "lucide-react";
import { translationEngine } from "./engine.js";
import { getSettings, subscribeSettings } from "../../config/settings.js";

interface TranslatorToggleProps {
  context?: {
    companyId?: string | null;
    companyPrefix?: string | null;
  };
}

export function TranslatorToggle({ context }: TranslatorToggleProps) {
  const [enabled, setEnabled] = useState(() => translationEngine.isEnabled);
  const [moduleEnabled, setModuleEnabled] = useState(() => getSettings().translator);

  useEffect(() => {
    const unsubEngine = translationEngine.subscribe((next) => {
      setEnabled(next);
    });
    const unsubSettings = subscribeSettings((settings) => {
      setModuleEnabled(settings.translator);
      if (!settings.translator && translationEngine.isEnabled) {
        translationEngine.setEnabled(false);
      }
    });
    return () => {
      unsubEngine();
      unsubSettings();
    };
  }, []);

  if (!moduleEnabled) return null;

  const title = enabled
    ? "Desativar tradução (pt-BR)"
    : "Ativar tradução (pt-BR)";

  return (
    <button
      type="button"
      onClick={() => translationEngine.toggle()}
      className={`inline-flex items-center justify-center h-8 px-2.5 rounded-md text-xs font-medium transition-colors border ${
        enabled
          ? "bg-accent text-accent-foreground border-border/80 shadow-xs"
          : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40 border-transparent"
      }`}
      aria-label={title}
      title={title}
    >
      <Languages className={`w-4 h-4 mr-1.5 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
      <span className="font-medium">{enabled ? "PT-BR" : "EN"}</span>
    </button>
  );
}
