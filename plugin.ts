import type { PluginOption } from "vite";
import path from "node:path";
import * as fs from "node:fs";

const __dirname = import.meta.dirname;
const templateFile = path.join(__dirname, "..", "dist", "index.html");
const template = fs.readFileSync(templateFile, "utf8");

export function bundleAnalyzer(): PluginOption {
  const modules: {
    id: string;
    size: number;
    importedIds: readonly string[];
    dynamicallyImportedIds: readonly string[];
  }[] = [];
  const cwd = process.cwd();
  function mapId(id: string) {
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
    generateBundle() {
      this.info(`Writing bundle-analyzer.json (${modules.length} modules)...`);
      this.emitFile({
        type: "asset",
        fileName: "bundle-analyzer.json",
        source: JSON.stringify(modules, null, 2),
      });
      this.info(`Writing bundle-squeeze.html...`);
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
