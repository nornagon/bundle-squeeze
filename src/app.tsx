import { useCallback, useEffect } from "preact/hooks";
import "./app.css";
import {
  ReadonlySignal,
  Signal,
  useComputed,
  useSignal,
} from "@preact/signals";

type SortKey = "self" | "total" | "unique" | "removed";

function cx(...args: (string | boolean | null | undefined)[]) {
  return args
    .flat()
    .filter((x) => typeof x === "string")
    .join(" ")
    .trim();
}

function Size({ size }: { size: number }) {
  const sizeInKB = size / 1024;
  const formattedSize = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(sizeInKB);

  return <span style={{ whiteSpace: "nowrap" }}>{formattedSize} KB</span>;
}

const modulesMapCache = new WeakMap<ModuleInfo[], Map<string, ModuleInfo>>();

function findModule(modules: ModuleInfo[], id: string) {
  if (!modulesMapCache.has(modules)) {
    const modulesMap = new Map<string, ModuleInfo>(
      modules.map((m) => [m.id, m])
    );
    modulesMapCache.set(modules, modulesMap);
  }
  const module = modulesMapCache.get(modules)!.get(id);
  if (!module) {
    throw new Error(`Module with id ${id} not found`);
  }
  return module;
}

function setsIntersect<T>(a: Set<T>, b: Set<T>) {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function Module({
  modules,
  path,
  entryPoint = path[path.length - 1],
  hoveredModule,
  selectedModule,
  filteredModules,
  ignoredModules,
  sortKey,
  sizer,
  depth = 0,
}: {
  modules: ModuleInfo[];
  path: ModuleInfo[];
  entryPoint?: ModuleInfo;
  hoveredModule: Signal<ModuleInfo | null>;
  selectedModule: Signal<ModuleInfo | null>;
  filteredModules: ReadonlySignal<Set<string>>;
  ignoredModules: Signal<Set<string>>;
  depth?: number;
  sortKey: SortKey;
  sizer: ReadonlySignal<Sizer>;
}) {
  const module = path[path.length - 1];
  const isOpen = useSignal(false);
  const highlightedModule = useComputed(
    () => hoveredModule.value ?? selectedModule.value
  );
  const isDepOfHovered = useComputed(
    () =>
      highlightedModule.value != null &&
      allTransitiveDependencies(modules, highlightedModule.value).has(module.id)
  );
  const hoveredIsDepOfThis = useComputed(
    () =>
      highlightedModule.value != null &&
      allTransitiveDependencies(modules, module).has(highlightedModule.value.id)
  );
  const isHovered = useComputed(
    () => highlightedModule.value?.id === module.id
  );
  const className = useComputed(() =>
    cx(
      "module",
      isOpen.value && "open",
      isDepOfHovered.value && "imported-by-hovered",
      hoveredIsDepOfThis.value && "imports-hovered",
      isHovered.value && "hovered",
      selectedModule.value?.id === module.id && "pinned",
      filteredModules.value.size > 0 &&
        !filteredModules.value.has(module.id) &&
        !setsIntersect(
          filteredModules.value,
          allTransitiveDependencies(modules, module)
        ) &&
        "filtered",
      ignoredModules.value.has(module.id) && "ignored"
    )
  );

  function showId(id: string) {
    if (/node_modules/.test(id)) {
      const nodeModulesIndex = id.lastIndexOf("node_modules");
      if (nodeModulesIndex === -1) {
        return id;
      }
      const parts = id.slice(nodeModulesIndex).split("/");
      const scopedPackage = parts[1].startsWith("@");
      const packageName = scopedPackage
        ? parts.slice(1, 3).join("/")
        : parts[1];
      return (
        <>
          <span style={{ fontWeight: "bold" }}>{packageName}</span>
          {`/${parts.slice(scopedPackage ? 3 : 2).join("/")}`}
        </>
      );
    }
    return id;
  }
  const onMouseEnter = useCallback(
    () => (hoveredModule.value = module),
    [module]
  );
  const onMouseLeave = useCallback(() => (hoveredModule.value = null), []);
  const onClick = useCallback(() => {
    isOpen.value = !isOpen.value;
  }, []);
  return (
    <>
      <tr className={className}>
        <td
          style={{
            paddingLeft: `${depth * 2}em`,
          }}
        >
          <span
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            className="module-id"
            style={{ whiteSpace: "nowrap" }}
          >
            <span className="icon">
              {module.importedIds.length > 0 ? (
                isOpen.value ? (
                  "▼"
                ) : (
                  "▶"
                )
              ) : (
                <span style={{ fontSize: "90%" }}>■</span>
              )}
            </span>
            {showId(module.id)}
          </span>
          <span className="module-actions">
            <button
              className="pin"
              onClick={() => {
                if (selectedModule.value?.id === module.id) {
                  selectedModule.value = null;
                } else {
                  selectedModule.value = module;
                }
              }}
            >
              {selectedModule.value?.id === module.id ? "📍" : "📌"}
            </button>
            <button
              className="ignore"
              onClick={() => {
                if (ignoredModules.value.has(module.id)) {
                  ignoredModules.value = new Set(
                    Array.from(ignoredModules.value).filter(
                      (m) => m !== module.id
                    )
                  );
                } else {
                  ignoredModules.value = new Set(
                    Array.from(ignoredModules.value).concat(module.id)
                  );
                }
              }}
            >
              ⛔️
            </button>
          </span>
        </td>
        <td className="size self">
          <Size size={sizer.value.size(module)} />
        </td>
        <td className="size total">
          <Size size={sizer.value.total(module)} />
        </td>
        <td className="size unique">
          <Size size={sizer.value.unique(entryPoint, path)} />
        </td>
        <td className="size removed">
          <Size size={sizer.value.removed(entryPoint, module)} />
        </td>
        <td className="chunk">{module.chunk}</td>
      </tr>
      {isOpen.value &&
        module.importedIds
          .toSorted((a, b) => {
            const aModule = findModule(modules, a);
            const bModule = findModule(modules, b);
            if (sortKey === "self") {
              return sizer.value.size(bModule) - sizer.value.size(aModule);
            } else if (sortKey === "total") {
              return sizer.value.total(bModule) - sizer.value.total(aModule);
            } else if (sortKey === "unique") {
              return (
                sizer.value.unique(entryPoint, [...path, bModule]) -
                sizer.value.unique(entryPoint, [...path, aModule])
              );
            } else if (sortKey === "removed") {
              return (
                sizer.value.removed(entryPoint, bModule) -
                sizer.value.removed(entryPoint, aModule)
              );
            }
            return 0;
          })
          .map((dep) => (
            <Module
              key={dep}
              modules={modules}
              path={[...path, findModule(modules, dep)]}
              entryPoint={entryPoint}
              hoveredModule={hoveredModule}
              selectedModule={selectedModule}
              filteredModules={filteredModules}
              ignoredModules={ignoredModules}
              depth={depth + 1}
              sortKey={sortKey}
              sizer={sizer}
            />
          ))}
    </>
  );
}

type ModuleInfo = {
  id: string;
  size: number;
  renderedSize?: number;
  chunk?: string;
  importedIds: string[];
  dynamicallyImportedIds: string[];
};

function importers(modules: ModuleInfo[], module: ModuleInfo) {
  return modules.filter(
    (m) =>
      m.importedIds.includes(module.id) ||
      m.dynamicallyImportedIds.includes(module.id)
  );
}

export function App() {
  const modules = useSignal<ModuleInfo[]>([]);
  useEffect(() => {
    const bundleAnalyzer = document.getElementById("bundle-analyzer");
    if (bundleAnalyzer?.textContent != null) {
      try {
        modules.value = JSON.parse(bundleAnalyzer.textContent);
        return;
      } catch (e) {
        console.error(e);
      }
    }

    // In dev, we can put temp data in public/bundle-analyzer.json
    fetch("./bundle-analyzer.json")
      .then((res) => res.json())
      .then((data) => (modules.value = data as ModuleInfo[]));
  }, []);
  const sortKey = useSignal<SortKey>("unique");
  const ignoredModules = useSignal(new Set<string>());
  const sizer = useComputed(
    () => new Sizer(modules.value, ignoredModules.value)
  );
  const entryPoints = useComputed(() => {
    return modules.value
      .filter((module) => importers(modules.value, module).length === 0)
      .toSorted((a, b) => {
        if (sortKey.value === "self") {
          return sizer.value.size(b) - sizer.value.size(a);
        } else {
          return sizer.value.total(b) - sizer.value.total(a);
        }
      });
  });
  const hoveredModule = useSignal<ModuleInfo | null>(null);
  const selectedModule = useSignal<ModuleInfo | null>(null);
  const filter = useSignal("");
  const filteredModules = useComputed(() => {
    return new Set(
      modules.value
        .filter((module) => module.id.includes(filter.value))
        .map((m) => m.id)
    );
  });

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>
              Module{" "}
              <input
                type="search"
                placeholder="Filter"
                value={filter.value}
                onInput={(e) => (filter.value = e.currentTarget.value)}
              />
            </th>
            <th>
              <button onClick={() => (sortKey.value = "self")}>Self</button>
              {sortKey.value === "self" && <span>▼</span>}
            </th>
            <th>
              <button onClick={() => (sortKey.value = "total")}>Total</button>
              {sortKey.value === "total" && <span>▼</span>}
            </th>
            <th>
              <button onClick={() => (sortKey.value = "unique")}>Unique</button>
              {sortKey.value === "unique" && <span>▼</span>}
            </th>
            <th>
              <button onClick={() => (sortKey.value = "removed")}>
                Removed
              </button>
              {sortKey.value === "removed" && <span>▼</span>}
            </th>
            <th>Chunk</th>
          </tr>
        </thead>
        <tbody>
          {modules &&
            entryPoints.value.map((module) => (
              <Module
                key={module.id}
                modules={modules.value}
                path={[module]}
                hoveredModule={hoveredModule}
                selectedModule={selectedModule}
                filteredModules={filteredModules}
                ignoredModules={ignoredModules}
                sortKey={sortKey.value}
                sizer={sizer}
              />
            ))}
        </tbody>
      </table>
    </div>
  );
}

class Sizer {
  totalSizeCache = new Map<string, number>();
  uniqueSizeCache = new Map<string, number>();
  removedSizeCache = new Map<string, number>();
  private ignoredModules: Set<string>;

  constructor(private modules: ModuleInfo[], ignoredModules: Set<string>) {
    this.ignoredModules = new Set();
    for (const module of ignoredModules) {
      this.ignoredModules.add(module);
      for (const dep of allTransitiveDependencies(
        this.modules,
        findModule(this.modules, module)
      )) {
        this.ignoredModules.add(dep);
      }
    }
  }

  size(module: ModuleInfo) {
    return module.renderedSize ?? module.size;
  }

  total(module: ModuleInfo) {
    if (/components/.test(module.id)) {
      debugger;
    }
    if (this.totalSizeCache.has(module.id)) {
      return this.totalSizeCache.get(module.id)!;
    }
    const deps = allTransitiveDependencies(this.modules, module);
    let total = 0;
    if (!this.ignoredModules.has(module.id)) {
      total += this.size(module);
    }
    for (const dep of deps) {
      if (dep === module.id) continue;
      if (!this.ignoredModules.has(dep)) {
        total += this.size(findModule(this.modules, dep));
      }
    }
    this.totalSizeCache.set(module.id, total);
    return total;
  }
  unique(entryPoint: ModuleInfo, path: ModuleInfo[]) {
    const cacheKey = `${entryPoint.id}\0${path.map((m) => m.id).join("\0")}`;
    if (this.uniqueSizeCache.has(cacheKey)) {
      return this.uniqueSizeCache.get(cacheKey)!;
    }
    const reachableFromChokePoint = new Set(
      reachableFrom(this.modules, path[path.length - 1])
    );
    for (const module of reachableFrom(
      this.modules,
      entryPoint,
      (p) =>
        !(p.length === path.length && p.every((m, i) => m.id === path[i].id))
    )) {
      reachableFromChokePoint.delete(module);
    }
    let total = 0;
    for (const module of reachableFromChokePoint) {
      if (!this.ignoredModules.has(module.id)) {
        total += this.size(module);
      }
    }
    this.uniqueSizeCache.set(cacheKey, total);
    return total;
  }

  removed(entryPoint: ModuleInfo, module: ModuleInfo) {
    const cacheKey = `${entryPoint.id}\0${module.id}`;
    if (this.removedSizeCache.has(cacheKey)) {
      return this.removedSizeCache.get(cacheKey)!;
    }
    const reachableFromModule = new Set(reachableFrom(this.modules, module));
    for (const m of reachableFrom(
      this.modules,
      entryPoint,
      (p) => p[p.length - 1].id !== module.id
    )) {
      reachableFromModule.delete(m);
    }
    let total = 0;
    for (const m of reachableFromModule) {
      if (!this.ignoredModules.has(m.id)) {
        total += this.size(m);
      }
    }
    this.removedSizeCache.set(cacheKey, total);
    return total;
  }
}

const transitiveDependenciesCache = new Map<string, Set<string>>();

function allTransitiveDependencies(
  modules: ModuleInfo[],
  module: ModuleInfo,
  visited = new Set<string>()
): Set<string> {
  if (transitiveDependenciesCache.has(module.id)) {
    return transitiveDependenciesCache.get(module.id)!;
  }

  if (visited.has(module.id)) {
    return new Set(); // Handle circular dependencies by returning an empty set
  }

  visited.add(module.id);

  const deps = new Set<string>();
  for (const dep of module.importedIds) {
    const depModule = findModule(modules, dep);
    deps.add(depModule.id);
    for (const transitiveDep of allTransitiveDependencies(
      modules,
      depModule,
      visited
    )) {
      deps.add(transitiveDep);
    }
  }

  transitiveDependenciesCache.set(module.id, deps);
  return deps;
}

function* reachableFrom(
  modules: ModuleInfo[],
  entryPoint: ModuleInfo,
  condition: (path: ModuleInfo[]) => boolean = () => true
) {
  if (!condition([entryPoint])) {
    return;
  }
  const visited = new Set<string>();
  const stack: ModuleInfo[][] = [[entryPoint]];
  while (stack.length > 0) {
    const path = stack.pop()!;
    const current = path[path.length - 1];
    visited.add(current.id);
    yield current;
    for (const dep of current.importedIds) {
      if (visited.has(dep)) continue;
      const depModule = findModule(modules, dep);
      const newPath = [...path, depModule];
      if (condition(newPath)) {
        stack.push(newPath);
      }
    }
  }
}
