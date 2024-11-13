import type { PluginOption } from "vite";
import path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const templateFile = path.join(__dirname, "..", "dist", "index.html");
const template = fs.readFileSync(templateFile, "utf8");

export function bundleAnalyzer(): PluginOption {
  const modules: {
    id: string;
    size: number;
    renderedSize?: number;
    chunk?: string;
    importedIds: readonly string[];
    dynamicallyImportedIds: readonly string[];
  }[] = [];
  const cwd = process.cwd();
  function mapId(id: string): string {
    if (id.startsWith("\x00/")) {
      return "\x00" + mapId(id.slice(1));
    }
    return path.relative(cwd, id);
  }
  return {
    enforce: "post",
    name: "bundle-analyzer",
    moduleParsed(moduleInfo) {
      const m = {
        id: mapId(moduleInfo.id),
        size: moduleInfo.code?.length ?? 0,
        importedIds: moduleInfo.importedIds.map(mapId),
        dynamicallyImportedIds: moduleInfo.dynamicallyImportedIds.map(mapId),
      };
      modules.push(m);
    },
    generateBundle(_opts, bundle) {
      for (const [file, source] of Object.entries(bundle)) {
        if (source.type === "chunk") {
          for (const [moduleIdUnmapped, module] of Object.entries(
            source.modules
          )) {
            const moduleId = mapId(moduleIdUnmapped);
            const mod = modules.find((m) => m.id === moduleId);
            if (mod) {
              mod.renderedSize = module.renderedLength;
              mod.chunk = file;
            } else {
              this.info(`Unknown module: ${moduleId}`);
            }
          }
        }
      }
      this.emitFile({
        type: "asset",
        fileName: "bundle-squeeze.json",
        source: JSON.stringify(modules, null, 2),
      });
      this.info(`Writing bundle-squeeze.html (${modules.length} modules)...`);
      this.emitFile({
        type: "asset",
        fileName: "bundle-squeeze.html",
        source: template.replace(
          "__BUNDLE_SQUEEZE_DATA__",
          JSON.stringify(modules)
        ),
      });
    },
  };
}
