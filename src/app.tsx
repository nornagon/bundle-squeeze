import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
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
  return <span>{formattedSize} KB</span>;
}

const modulesMapCache = new WeakMap<ModuleInfo[], Map<string, ModuleInfo>>();

function findModule(modules: ModuleInfo[], id: string) {
  if (!modulesMapCache.has(modules)) {
    const modulesMap = new Map<string, ModuleInfo>(
      modules.map((m) => [m.id, m])
    );
    modulesMapCache.set(modules, modulesMap);
  }
  return modulesMapCache.get(modules)!.get(id);
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
  sortKey,
  depth = 0,
}: {
  modules: ModuleInfo[];
  path: ModuleInfo[];
  entryPoint?: ModuleInfo;
  hoveredModule: Signal<ModuleInfo | null>;
  selectedModule: Signal<ModuleInfo | null>;
  filteredModules: ReadonlySignal<Set<string>>;
  depth?: number;
  sortKey: SortKey;
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
        "filtered"
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
        </td>
        <td className="size self">
          <Size size={module.size} />
        </td>
        <td className="size total">
          <Size size={totalSize(modules, module)} />
        </td>
        <td className="size unique">
          <Size size={uniqueSize(modules, entryPoint, path)} />
        </td>
        <td className="size removed">
          <Size size={removedSize(modules, entryPoint, module)} />
        </td>
      </tr>
      {isOpen.value &&
        module.importedIds
          .toSorted((a, b) => {
            const aModule = findModule(modules, a);
            const bModule = findModule(modules, b);
            if (aModule == null || bModule == null) {
              return 0;
            }
            if (sortKey === "self") {
              return bModule.size - aModule.size;
            } else if (sortKey === "total") {
              return totalSize(modules, bModule) - totalSize(modules, aModule);
            } else if (sortKey === "unique") {
              return (
                uniqueSize(modules, entryPoint, [...path, bModule]) -
                uniqueSize(modules, entryPoint, [...path, aModule])
              );
            } else if (sortKey === "removed") {
              return (
                removedSize(modules, entryPoint, bModule) -
                removedSize(modules, entryPoint, aModule)
              );
            }
            return 0;
          })
          .map((dep) => (
            <Module
              key={dep}
              modules={modules}
              path={[...path, findModule(modules, dep)!]}
              entryPoint={entryPoint}
              hoveredModule={hoveredModule}
              selectedModule={selectedModule}
              filteredModules={filteredModules}
              depth={depth + 1}
              sortKey={sortKey}
            />
          ))}
    </>
  );
}

type ModuleInfo = {
  id: string;
  size: number;
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
  const [modules, setData] = useState<ModuleInfo[] | null>(null);
  useEffect(() => {
    const bundleAnalyzer = document.getElementById("bundle-analyzer");
    if (bundleAnalyzer?.textContent != null) {
      try {
        setData(JSON.parse(bundleAnalyzer.textContent));
        return;
      } catch (e) {
        console.error(e);
      }
    }

    // In dev, we can put temp data in public/bundle-analyzer.json
    fetch("./bundle-analyzer.json")
      .then((res) => res.json())
      .then((data) =>
        setData(
          (data as ModuleInfo[]).toSorted(
            (a, b) => totalSize(data, b) - totalSize(data, a)
          )
        )
      );
  }, []);
  const [sortKey, setSortKey] = useState<SortKey>("unique");
  const entryPoints = useMemo(() => {
    return modules
      ?.filter((module) => importers(modules, module).length === 0)
      .toSorted((a, b) => {
        if (sortKey === "self") {
          return b.size - a.size;
        } else {
          return totalSize(modules, b) - totalSize(modules, a);
        }
      });
  }, [modules, sortKey]);
  const hoveredModule = useSignal<ModuleInfo | null>(null);
  const selectedModule = useSignal<ModuleInfo | null>(null);
  const filter = useSignal("");
  const filteredModules = useComputed(() => {
    return new Set(
      modules
        ?.filter((module) => module.id.includes(filter.value))
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
              <button onClick={() => setSortKey("self")}>Self</button>
              {sortKey === "self" && <span>▼</span>}
            </th>
            <th>
              <button onClick={() => setSortKey("total")}>Total</button>
              {sortKey === "total" && <span>▼</span>}
            </th>
            <th>
              <button onClick={() => setSortKey("unique")}>Unique</button>
              {sortKey === "unique" && <span>▼</span>}
            </th>
            <th>
              <button onClick={() => setSortKey("removed")}>Removed</button>
              {sortKey === "removed" && <span>▼</span>}
            </th>
          </tr>
        </thead>
        <tbody>
          {modules &&
            entryPoints?.map((module) => (
              <Module
                key={module.id}
                modules={modules}
                path={[module]}
                hoveredModule={hoveredModule}
                selectedModule={selectedModule}
                filteredModules={filteredModules}
                sortKey={sortKey}
              />
            ))}
        </tbody>
      </table>
    </div>
  );
}

const totalSizeCache = new Map<string, number>();

function totalSize(modules: ModuleInfo[], module: ModuleInfo) {
  if (totalSizeCache.has(module.id)) {
    return totalSizeCache.get(module.id)!;
  }
  const self = module.size;
  const deps = allTransitiveDependencies(modules, module);
  let total = self;
  for (const dep of deps) {
    const depModule = findModule(modules, dep);
    if (depModule != null) {
      total += depModule.size;
    }
  }
  totalSizeCache.set(module.id, total);
  return total;
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
    if (depModule != null) {
      deps.add(depModule.id);
      for (const transitiveDep of allTransitiveDependencies(
        modules,
        depModule,
        visited
      )) {
        deps.add(transitiveDep);
      }
    }
  }

  transitiveDependenciesCache.set(module.id, deps);
  return deps;
}

const uniqueSizeCache = new Map<string, number>();

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
      if (depModule == null) throw new Error(`Module ${dep} not found`);
      const newPath = [...path, depModule];
      if (condition(newPath)) {
        stack.push(newPath);
      }
    }
  }
}

function uniqueSize(
  modules: ModuleInfo[],
  entryPoint: ModuleInfo,
  path: ModuleInfo[]
) {
  const cacheKey = `${entryPoint.id}\0${path.map((m) => m.id).join("\0")}`;
  if (uniqueSizeCache.has(cacheKey)) {
    return uniqueSizeCache.get(cacheKey)!;
  }
  const reachableFromChokePoint = new Set(
    reachableFrom(modules, path[path.length - 1])
  );
  for (const module of reachableFrom(
    modules,
    entryPoint,
    (p) => !(p.length === path.length && p.every((m, i) => m.id === path[i].id))
  )) {
    reachableFromChokePoint.delete(module);
  }
  let total = 0;
  for (const module of reachableFromChokePoint) {
    total += module.size;
  }
  uniqueSizeCache.set(cacheKey, total);
  return total;
}

const removedSizeCache = new Map<string, number>();
function removedSize(
  modules: ModuleInfo[],
  entryPoint: ModuleInfo,
  module: ModuleInfo
) {
  const cacheKey = `${entryPoint.id}\0${module.id}`;
  if (removedSizeCache.has(cacheKey)) {
    return removedSizeCache.get(cacheKey)!;
  }
  const reachableFromModule = new Set(reachableFrom(modules, module));
  for (const m of reachableFrom(
    modules,
    entryPoint,
    (p) => p[p.length - 1].id !== module.id
  )) {
    reachableFromModule.delete(m);
  }
  let total = 0;
  for (const m of reachableFromModule) {
    total += m.size;
  }
  removedSizeCache.set(cacheKey, total);
  return total;
}
