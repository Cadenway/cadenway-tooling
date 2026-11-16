import { posix } from 'node:path';

import ts from 'typescript';

import type { GraphEdge } from './architecture-graph.js';
import { kitExportNamespace } from './architecture-kit-entries.js';
import { isTest, normalizePath, type ImportEdge } from './architecture-project.js';

type Report = (rule: string, message: string, line?: number) => void;
type ReportFile = (file: string, rule: string, message: string, line?: number) => void;

interface KitPackage {
  readonly name: string;
  readonly root: string;
  readonly manifest: string;
  readonly entries: ReadonlyMap<string, readonly string[]>;
  readonly dependencies: ReadonlySet<string>;
}

interface StrictKit {
  readonly packages: ReadonlyMap<string, KitPackage>;
  readonly owners: ReadonlyMap<string, KitPackage>;
  readonly files: ReadonlySet<string>;
}

const JOBS_RUNTIME = /^packages\/nest-jobs\/src\/runtime\//u;
const JOBS_PROVISIONING = /^packages\/nest-jobs\/src\/provisioning\//u;
const OUTBOX_WRITER = /^packages\/nest-messaging\/src\/outbox\/writer\//u;
const OUTBOX_RELAY = /^packages\/nest-messaging\/src\/outbox\/relay\//u;
const OUTBOX_SCHEMA = /^packages\/nest-messaging\/src\/outbox\/schema\//u;
const OUTBOX_RUNTIME = /^packages\/nest-messaging\/src\/outbox\/(?:writer|relay|wiring)\//u;
const DATABASE = /^packages\/nest-common\/src\/database\//u;
const TOKEN_GUARD =
  /^packages\/nest-common\/src\/auth\/(?:internal-token\/)?internal-token\.guard\.ts$/u;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownerPath(file: string | undefined): string | undefined {
  return file && /^packages\/[^/]+(?=\/)/u.exec(file)?.[0];
}

/** Maps TypeScript build output and declarations to the authored source. */
function authoredFile(file: string, files: ReadonlySet<string>): string | undefined {
  if (files.has(file)) return file;
  const source = file.replace(/^(packages\/[^/]+)\/dist\//u, '$1/src/');
  const typed = source
    .replace(/(?:\.d\.ts|\.js)$/u, '.ts')
    .replace(/(?:\.d\.mts|\.mjs)$/u, '.mts')
    .replace(/(?:\.d\.cts|\.cjs)$/u, '.cts');
  if (files.has(typed)) return typed;
  return files.has(source) ? source : undefined;
}

function exportTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  return record(value) ? Object.values(value).flatMap(exportTargets) : [];
}

function subpathEntries(exports: unknown): readonly [string, unknown][] {
  return record(exports) && Object.keys(exports).some((name) => name.startsWith('.'))
    ? Object.entries(exports)
    : [['.', exports]];
}

function readPackage(
  rootDir: string,
  root: string,
  files: ReadonlySet<string>,
  report: ReportFile,
): KitPackage | undefined {
  const manifest = `${root}/package.json`;
  const content = ts.sys.readFile(`${rootDir}/${manifest}`);
  if (content === undefined) {
    report(manifest, 'kit-package-manifest', 'Declare a package manifest for this kit package.');
    return undefined;
  }

  const data: unknown = JSON.parse(content);
  if (!record(data) || typeof data.name !== 'string' || !data.name.trim()) {
    report(manifest, 'kit-package-manifest', 'Set a name for this kit package.');
    return undefined;
  }
  const entries = new Map<string, readonly string[]>();
  for (const [subpath, value] of subpathEntries(data.exports)) {
    if (value === null) continue;
    const targets = exportTargets(value);
    const specifier = subpath === '.' ? data.name : `${data.name}/${subpath.slice(2)}`;
    if (
      (subpath !== '.' && !subpath.startsWith('./')) ||
      subpath.includes('*') ||
      !targets.length
    ) {
      report(manifest, 'kit-package-export', `Declare an explicit export for ${specifier}.`);
      continue;
    }
    const namespace = kitExportNamespace(specifier);
    const authored = new Set<string>();
    for (const target of targets) {
      const path = posix.normalize(`${root}/${target}`);
      const file =
        target.startsWith('./') && path.startsWith(`${root}/`)
          ? authoredFile(path, files)
          : undefined;
      if (!file || isTest(file, true)) {
        report(
          manifest,
          'kit-package-export',
          `Export ${specifier} from authored production code. Its target ${target} is missing or test-only.`,
        );
      } else if (namespace && !file.startsWith(`${root}/src/${namespace}/`)) {
        report(
          manifest,
          'kit-package-namespace',
          `Export ${specifier} from src/${namespace}/. Its target ${target} points to ${file}.`,
        );
      } else {
        authored.add(file);
      }
    }
    if (authored.size) entries.set(specifier, [...authored]);
  }

  const dependencies = new Set<string>();
  for (const field of [data.dependencies, data.optionalDependencies, data.peerDependencies]) {
    if (record(field)) for (const name of Object.keys(field)) dependencies.add(name);
  }
  return { name: data.name, root, manifest, entries, dependencies };
}

function canDependOn(source: KitPackage, target: KitPackage): boolean {
  return (
    source === target ||
    (source.name === '@cadenway/nest-messaging' && target.name === '@cadenway/nest-common')
  );
}

export function readStrictKit(
  rootDir: string,
  files: ReadonlySet<string>,
  report: ReportFile,
): StrictKit {
  const roots = new Set<string>();
  for (const file of files) {
    const root = ownerPath(file);
    if (root) roots.add(root);
  }
  const packages = new Map<string, KitPackage>();
  const owners = new Map<string, KitPackage>();
  for (const root of roots) {
    const pkg = readPackage(normalizePath(rootDir), root, files, report);
    if (!pkg) continue;
    owners.set(root, pkg);
    if (packages.has(pkg.name)) {
      report(pkg.manifest, 'kit-package-manifest', `Kit package name ${pkg.name} is duplicated.`);
      continue;
    }
    packages.set(pkg.name, pkg);
  }
  for (const source of owners.values()) {
    for (const dependency of source.dependencies) {
      const target = packages.get(dependency);
      if (target && !canDependOn(source, target)) {
        report(
          source.manifest,
          'kit-package-direction',
          `${source.name} cannot depend on ${target.name}.`,
        );
      }
    }
  }
  return { packages, owners, files };
}

function specifierPackage(specifier: string): string | undefined {
  return /^(?:@[^/]+\/[^/]+|[^/]+)/u.exec(specifier)?.[0];
}

/** Resolves declared cross-package imports even before a workspace build. */
export function checkStrictKitImport(
  kit: StrictKit,
  file: string,
  edge: ImportEdge,
  resolved: string | undefined,
  report: Report,
): string | undefined {
  const source = kit.owners.get(ownerPath(file) ?? '');
  if (!source) return resolved;
  const namedPackage = kit.packages.get(specifierPackage(edge.specifier) ?? '');
  const resolvedPackage = kit.owners.get(ownerPath(resolved) ?? '');
  const target = resolvedPackage ?? namedPackage;
  if (!target) return resolved;

  const actual = resolved && authoredFile(resolved, kit.files);
  const entries = namedPackage?.entries.get(edge.specifier);
  const endpoint = actual || entries?.[0] || resolved;
  if (target !== source || namedPackage) {
    if (
      namedPackage !== target ||
      !entries ||
      (actual ? !entries.includes(actual) : resolvedPackage !== undefined) ||
      (resolved && !resolvedPackage && !resolved.includes('node_modules/'))
    ) {
      report(
        'kit-package-private',
        `Import ${target.name} through a declared package entry.`,
        edge.line,
      );
    }
  }
  const forbidden = !canDependOn(source, target)
    ? target
    : namedPackage && !canDependOn(source, namedPackage)
      ? namedPackage
      : undefined;
  if (forbidden) {
    report(
      'kit-package-direction',
      `${source.name} cannot depend on ${forbidden.name}.`,
      edge.line,
    );
  } else if (
    target !== source &&
    namedPackage === target &&
    entries &&
    !source.dependencies.has(target.name)
  ) {
    report(
      'kit-package-dependency',
      `Declare ${target.name} as a production dependency or peer of ${source.name}.`,
      edge.line,
    );
  }
  return endpoint;
}

/** Follows type, dynamic and eager imports across the internal runtime boundaries. */
export function checkKitRuntimeBoundaries(
  graph: ReadonlyMap<string, readonly GraphEdge[]>,
  report: ReportFile,
): void {
  const importers = new Map<string, string[]>();
  for (const [source, edges] of graph) {
    for (const edge of edges) {
      const sources = importers.get(edge.target) ?? [];
      sources.push(source);
      importers.set(edge.target, sources);
    }
  }
  const check = (sourceOf: RegExp, targetOf: RegExp, rule: string, message: string): void => {
    const reachable = new Set([...graph.keys()].filter((file) => targetOf.test(file)));
    for (const file of reachable) {
      for (const importer of importers.get(file) ?? []) reachable.add(importer);
    }
    for (const [source, edges] of graph) {
      if (!sourceOf.test(source)) continue;
      for (const edge of edges) {
        if (reachable.has(edge.target))
          report(source, rule, `${message} (${edge.target}).`, edge.line);
      }
    }
  };
  check(
    JOBS_RUNTIME,
    JOBS_PROVISIONING,
    'kit-runtime-provisioning',
    'The job runtime cannot depend on provisioning',
  );
  check(
    JOBS_PROVISIONING,
    JOBS_RUNTIME,
    'kit-provisioning-runtime',
    'Job provisioning cannot depend on the runtime',
  );
  check(
    OUTBOX_WRITER,
    OUTBOX_RELAY,
    'kit-outbox-writer-relay',
    'The outbox writer cannot depend on the relay',
  );
  check(
    OUTBOX_RELAY,
    OUTBOX_WRITER,
    'kit-outbox-relay-writer',
    'The outbox relay cannot depend on the writer',
  );
  check(
    OUTBOX_SCHEMA,
    OUTBOX_RUNTIME,
    'kit-outbox-schema-runtime',
    'Outbox schema definitions cannot depend on runtime components',
  );
  check(
    DATABASE,
    TOKEN_GUARD,
    'kit-database-auth-guard',
    'The database must read request context independently of the token guard',
  );
}
