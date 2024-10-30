import type { IModule } from "dependency-cruiser";
import { HTMLAttributes } from "preact/compat";
import { useEffect, useMemo, useState } from "preact/hooks";

function Size({ size }: { size: number }) {
  const sizeInKB = size / 1024;
  const formattedSize = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(sizeInKB);
  return <span>{formattedSize} KB</span>;
}

function isValid(module: {
  coreModule?: boolean;
  dependencyTypes?: string | string[];
}) {
  return !module.coreModule;
}

const modulesMapCache = new WeakMap<IModule[], Map<string, IModule>>();

function findModule(modules: IModule[], source: string) {
  if (!modulesMapCache.has(modules)) {
    const modulesMap = new Map<string, IModule>(
      modules.map((m) => [m.source, m])
    );
    modulesMapCache.set(modules, modulesMap);
  }
  return modulesMapCache.get(modules)!.get(source);
}

function Module({
  modules,
  module,
  entryPoint = module,
  hoveredModule,
  setHoveredModule,
}: {
  modules: IModule[];
  module: IModule;
  entryPoint?: IModule;
  hoveredModule: IModule | null;
  setHoveredModule: (module: IModule | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isDepOfHovered =
    hoveredModule != null &&
    allTransitiveDependencies(modules, hoveredModule).has(module.source);
  const hoveredIsDepOfThis =
    hoveredModule != null &&
    allTransitiveDependencies(modules, module).has(hoveredModule.source);
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
            color: isDepOfHovered
              ? "red"
              : hoveredIsDepOfThis
              ? "blue"
              : "inherit",
          }}
        >
          {module.source} (self <Size size={module.minifiedSize} />, total{" "}
          <Size size={totalSize(modules, module)} />, unique{" "}
          <Size size={uniqueSize(modules, entryPoint, module)} />)
        </summary>
        {isOpen && (
          <ul>
            {module.dependencies
              .filter((dep) => !dep.dynamic && isValid(dep))
              .toSorted((a, b) => {
                const aModule = findModule(modules, a.resolved);
                const bModule = findModule(modules, b.resolved);
                if (aModule == null || bModule == null) {
                  return 0;
                }
                return (
                  uniqueSize(modules, entryPoint, bModule) -
                  uniqueSize(modules, entryPoint, aModule)
                );
              })
              .map((dep) => (
                <li key={dep.resolved}>
                  <Module
                    modules={modules}
                    module={findModule(modules, dep.resolved)!}
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

export function App() {
  const [modules, setData] = useState<IModule[] | null>(null);
  useEffect(() => {
    fetch("./depcruise.json")
      .then((res) => res.json())
      .then((data) =>
        setData(
          (data as IModule[]).toSorted(
            (a, b) => totalSize(data, b) - totalSize(data, a)
          )
        )
      );
  }, []);
  const entryPoints = useMemo(() => {
    return modules?.filter((module) => module.dependents.length === 0);
  }, [modules]);
  const [hoveredModule, setHoveredModule] = useState<IModule | null>(null);

  return (
    modules != null && (
      <ul>
        {entryPoints?.map((module) => (
          <Module
            key={module.source}
            modules={modules}
            module={module}
            setHoveredModule={setHoveredModule}
            hoveredModule={hoveredModule}
          />
        ))}
      </ul>
    )
  );
}

const totalSizeCache = new Map<string, number>();

function totalSize(modules: IModule[], module: IModule) {
  if (totalSizeCache.has(module.source)) {
    return totalSizeCache.get(module.source)!;
  }
  const self = module.minifiedSize;
  const deps = allTransitiveDependencies(modules, module);
  let total = self;
  for (const dep of deps) {
    const depModule = findModule(modules, dep);
    if (depModule != null) {
      total += depModule.minifiedSize;
    }
  }
  totalSizeCache.set(module.source, total);
  return total;
}

const transitiveDependenciesCache = new Map<string, Set<string>>();

function allTransitiveDependencies(
  modules: IModule[],
  module: IModule
): Set<string> {
  if (transitiveDependenciesCache.has(module.source)) {
    return transitiveDependenciesCache.get(module.source)!;
  }

  const deps = new Set<string>();
  for (const dep of module.dependencies) {
    if (dep.dynamic || dep.coreModule) {
      continue;
    }
    const depModule = findModule(modules, dep.resolved);
    if (depModule != null) {
      deps.add(depModule.source);
      for (const transitiveDep of allTransitiveDependencies(
        modules,
        depModule
      )) {
        deps.add(transitiveDep);
      }
    }
  }

  transitiveDependenciesCache.set(module.source, deps);
  return deps;
}

const uniqueSizeCache = new Map<string, number>();

function uniqueSize(
  modules: IModule[],
  entryPoint: IModule,
  chokePoint: IModule
) {
  const cacheKey = `${entryPoint.source}-${chokePoint.source}`;
  if (uniqueSizeCache.has(cacheKey)) {
    return uniqueSizeCache.get(cacheKey)!;
  }
  if (entryPoint.source === chokePoint.source) {
    return totalSize(modules, chokePoint);
  }

  const modulesMap = new Map<string, IModule>(
    modules.map((m) => [m.source, m])
  );
  const deps = allTransitiveDependencies(modules, chokePoint);
  let total = chokePoint.minifiedSize;
  for (const dep of deps) {
    const depModule = modulesMap.get(dep);
    if (
      depModule != null &&
      !reachableFromWithout(modules, entryPoint, depModule, chokePoint)
    ) {
      total += depModule.minifiedSize;
    }
  }
  uniqueSizeCache.set(cacheKey, total);
  return total;
}
function reachableFromWithout(
  modules: IModule[],
  entryPoint: IModule,
  target: IModule,
  avoid: IModule
) {
  if (!allTransitiveDependencies(modules, entryPoint).has(target.source)) {
    return false;
  }
  const visited = new Set<string>();
  const stack = [entryPoint];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.source === target.source) {
      return true;
    }
    if (current.source === avoid.source || visited.has(current.source)) {
      continue;
    }
    visited.add(current.source);

    for (const dep of current.dependencies) {
      const depModule = findModule(modules, dep.resolved);
      if (depModule != null) {
        stack.push(depModule);
      }
    }
  }

  return false;
}

declare module "dependency-cruiser" {
  interface IModule {
    minifiedSize: number;
  }
}
