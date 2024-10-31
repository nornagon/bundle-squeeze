import { useEffect, useMemo, useState } from "preact/hooks";

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

function Module({
  modules,
  path,
  entryPoint = path[path.length - 1],
  hoveredModule,
  setHoveredModule,
}: {
  modules: ModuleInfo[];
  path: ModuleInfo[];
  entryPoint?: ModuleInfo;
  hoveredModule: ModuleInfo | null;
  setHoveredModule: (module: ModuleInfo | null) => void;
}) {
  const module = path[path.length - 1];
  const [isOpen, setIsOpen] = useState(false);
  const isDepOfHovered =
    hoveredModule != null &&
    allTransitiveDependencies(modules, hoveredModule).has(module.id);
  const hoveredIsDepOfThis =
    hoveredModule != null &&
    allTransitiveDependencies(modules, module).has(hoveredModule.id);
  const isHovered = hoveredModule?.id === module.id;

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
  return (
    <li>
      <details open={isOpen}>
        <summary
          onClick={(e) => {
            e.preventDefault();
            setIsOpen(!isOpen);
          }}
          onMouseEnter={() => setHoveredModule(module)}
          onMouseLeave={() => setHoveredModule(null)}
          style={{
            color: isHovered
              ? "red"
              : isDepOfHovered
              ? "blue"
              : hoveredIsDepOfThis
              ? "green"
              : "inherit",
          }}
        >
          {showId(module.id)} (self <Size size={module.size} />, total{" "}
          <Size size={totalSize(modules, module)} />, unique{" "}
          <Size size={uniqueSize(modules, entryPoint, path)} />)
        </summary>
        {isOpen && (
          <ul>
            {module.importedIds
              .toSorted((a, b) => {
                const aModule = findModule(modules, a);
                const bModule = findModule(modules, b);
                if (aModule == null || bModule == null) {
                  return 0;
                }
                return (
                  uniqueSize(modules, entryPoint, [...path, bModule]) -
                  uniqueSize(modules, entryPoint, [...path, aModule])
                );
              })
              .map((dep) => (
                <li key={dep}>
                  <Module
                    modules={modules}
                    path={[...path, findModule(modules, dep)!]}
                    entryPoint={entryPoint}
                    hoveredModule={hoveredModule}
                    setHoveredModule={setHoveredModule}
                  />
                </li>
              ))}
          </ul>
        )}
      </details>
    </li>
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
  const entryPoints = useMemo(() => {
    return modules?.filter((module) => importers(modules, module).length === 0);
  }, [modules]);
  const [hoveredModule, setHoveredModule] = useState<ModuleInfo | null>(null);

  return (
    modules != null && (
      <ul>
        {entryPoints?.map((module) => (
          <Module
            key={module.id}
            modules={modules}
            path={[module]}
            setHoveredModule={setHoveredModule}
            hoveredModule={hoveredModule}
          />
        ))}
      </ul>
    )
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
