import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "max.paperclip-plugin";

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.logger.info("MaxPaperclipPlugin unificado inicializado com sucesso.");
  },

  async onHealth() {
    return {
      status: "ok",
      message: "MaxPaperclipPlugin operacional (AutoSave, Tradutor, Iconify, Tarefas, Capacidades)",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
