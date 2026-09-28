import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";
import { fileURLToPath } from "node:url";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");
const sharedDistEntry = fileURLToPath(
  new URL("./node_modules/@paperclipai/shared/dist/index.js", import.meta.url),
);

// O tarball publicado pelo Paperclip contém somente dist/, mas o export padrão
// ainda aponta para src/index.ts. Direcionamos o bundler à entrada publicada,
// resolvida relativamente ao próprio projeto para funcionar em qualquer máquina.
for (const target of [presets.esbuild.worker, presets.esbuild.manifest, presets.esbuild.ui]) {
  target.alias = {
    ...target.alias,
    "@paperclipai/shared": sharedDistEntry,
  };
}

const workerCtx = await esbuild.context(presets.esbuild.worker);
const manifestCtx = await esbuild.context(presets.esbuild.manifest);
const uiCtx = await esbuild.context(presets.esbuild.ui);

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch()]);
  console.log("[MaxPaperclipPlugin] esbuild watch mode ativo para worker, manifest e ui");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx.dispose()]);
  console.log("[MaxPaperclipPlugin] Build concluído com sucesso!");
}
