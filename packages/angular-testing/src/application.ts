import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import ts from 'typescript';
import { exportedNames, importOrigins } from './exports.js';
import {
  isWithin,
  report,
  type ArchitectureFinding,
  type ImportEdge,
  type Project,
  type ProjectFile,
} from './project.js';

const APPLICATION_ROOT = 'src/app';
const LAYERS = new Set(['core', 'features', 'layouts', 'shared']);
const API_CLIENT = '@cadenway/api-client';
const UI_PACKAGE = '@cadenway/ui';
const ALIAS = /^@(app|core|features|layouts|shared|env)(?:\/|$)/u;

interface Feature {
  readonly root: string;
  readonly owner: string;
  readonly entries: ReadonlyMap<string, ReadonlySet<string>>;
}

export function applicationFindings(project: Project): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];
  const features = readFeatures(project, findings);
  const consumers = new Set(['app', ...features.map(({ owner }) => owner)]);
  for (const directory of project.directories) {
    if (dirname(directory) === 'src/app/layouts') consumers.add(`layouts/${basename(directory)}`);
    if (dirname(directory) === APPLICATION_ROOT && !LAYERS.has(basename(directory))) {
      findings.push({
        file: directory,
        line: 1,
        rule: 'app-layout',
        message: 'Business folders belong under src/app/features/.',
      });
    }
  }
  for (const feature of features) {
    validateEntries(project, feature, consumers, findings);
  }
  for (const file of project.files.values()) {
    if (isWithin(file.file, APPLICATION_ROOT)) {
      checkSource(project, file, features, findings);
    }
  }
  return findings;
}

function readFeatures(project: Project, findings: ArchitectureFinding[]): Feature[] {
  const directories = [...project.directories].filter(
    (directory) =>
      isWithin(directory, 'src/app/features') && basename(dirname(directory)) === 'features',
  );
  return directories
    .flatMap((root) => {
      const contract = `${root}/FEATURE.md`;
      if (!project.paths.has(contract)) {
        findings.push({
          file: root,
          line: 1,
          rule: 'feature-contract',
          message: 'Every feature needs its own FEATURE.md.',
        });
        return [];
      }
      const entries = new Map<string, Set<string>>();
      let fenced = false;
      let publicEntries = false;
      for (const line of readFileSync(resolve(project.root, contract), 'utf-8').split(/\r?\n/u)) {
        if (/^\s*```/u.test(line)) fenced = !fenced;
        if (fenced) continue;
        if (/^#{1,2} /u.test(line)) publicEntries = line.trim() === '## Public entry points';
        if (!publicEntries) continue;
        const row = /^\|\s*`([^`]+)`\s*\|([^|]+)\|\s*$/u.exec(line);
        if (!row?.[1] || !row[2]) continue;
        entries.set(
          row[1],
          new Set(row[2].split(',').map((cell) => cell.trim().replaceAll('`', ''))),
        );
      }
      return [{ root, owner: root.slice('src/app/features/'.length), entries }];
    })
    .sort((first, second) => second.root.length - first.root.length);
}

function entryFile(feature: Feature, entry: string, project: Project): string | undefined {
  if (entry === '.') return `${feature.root}/index.ts`;
  if (
    !/^[\w.-]+(?:\/[\w.-]+)*$/u.test(entry) ||
    entry.split('/').some((part) => part === '.' || part === '..')
  ) {
    return undefined;
  }
  const candidate = `${feature.root}/${entry}`;
  if (entry.endsWith('.routes') && dirname(candidate) === feature.root) return `${candidate}.ts`;
  if (entry.startsWith('ui/pages/') || /^data-access\/(services|adapters)\//u.test(entry))
    return undefined;
  const directoryEntry = `${candidate}/index.ts`;
  if (project.paths.has(directoryEntry)) return directoryEntry;
  return /^state\/.+\/events$/u.test(entry) ? `${candidate}.ts` : undefined;
}

function validateEntries(
  project: Project,
  feature: Feature,
  consumers: ReadonlySet<string>,
  findings: ArchitectureFinding[],
): void {
  for (const [entry, allowed] of feature.entries) {
    const path = entryFile(feature, entry, project);
    if (!path || !project.paths.has(path) || [...allowed].some((name) => !consumers.has(name))) {
      findings.push({
        file: `${feature.root}/FEATURE.md`,
        line: 1,
        rule: 'feature-contract',
        message: `Invalid public entry or consumer in the row for ${entry}.`,
      });
    }
  }
}

function ownerOf(file: string, features: readonly Feature[]): string {
  const feature = features.find(({ root }) => isWithin(file, root));
  if (feature) return feature.owner;
  const [, , layer, concern] = file.split('/');
  return layer && concern && LAYERS.has(layer) ? `${layer}/${concern}` : 'app';
}

function routeFile(file: string): boolean {
  return file.endsWith('.routes.ts') && !file.endsWith('.routes.server.ts');
}

function checkSource(
  project: Project,
  file: ProjectFile,
  features: readonly Feature[],
  findings: ArchitectureFinding[],
): void {
  if (file.file.endsWith('.spec.ts')) return;
  const inFeature = features.find(({ root }) => isWithin(file.file, root));
  if (
    file.file.includes('/ui/pages/') &&
    file.file.endsWith('.component.ts') &&
    dirname(file.file).endsWith('-page')
  ) {
    if (basename(file.file) !== `${basename(dirname(file.file))}.component.ts`) {
      findings.push(report(file, 'angular-naming', 'Page components use the page folder name.'));
    }
  } else if (file.file.includes('/ui/pages/') && file.file.endsWith('.component.ts')) {
    findings.push(report(file, 'angular-naming', 'Page components live in a *-page folder.'));
  }
  if (routeFile(file.file)) checkRoutes(file, inFeature, findings);
  if (
    inFeature &&
    /\.(?:guard|resolver|interceptor)\.ts$/u.test(file.file) &&
    !isWithin(file.file, `${inFeature.root}/http`)
  ) {
    findings.push(
      report(
        file,
        'feature-placement',
        'Feature guards, resolvers and interceptors belong in http/.',
      ),
    );
  }
  if (
    inFeature &&
    /\/(?:pages|components|forms|tables|dataviews|dialogs|sheets)\//u.test(
      file.file.slice(inFeature.root.length),
    ) &&
    !isWithin(file.file, `${inFeature.root}/ui`)
  ) {
    findings.push(report(file, 'feature-placement', 'Feature presentation belongs in ui/.'));
  }
  for (const edge of file.edges) {
    checkImport(project, file, edge, features, findings);
  }
}

function checkImport(
  project: Project,
  file: ProjectFile,
  edge: ImportEdge,
  features: readonly Feature[],
  findings: ArchitectureFinding[],
): void {
  const reject = (rule: string, message: string): void => {
    findings.push(report(file, rule, message, edge.node));
  };
  const target = edge.target;
  const origins = importOrigins(project, edge);
  if (
    origins.some(
      ({ external }) => external === API_CLIENT || external?.startsWith(`${API_CLIENT}/`),
    )
  ) {
    if (!file.file.includes('/data-access/') && !isWithin(file.file, 'src/app/core/api/client')) {
      reject(
        'api-client-boundary',
        'Map generated API types inside data-access/ or core/api/client/.',
      );
    }
    if (edge.exported)
      reject('api-client-boundary', 'Generated API symbols cannot leave the transport boundary.');
  }
  if (
    origins.some(
      ({ external, symbol }) =>
        external === '@angular/common/http' && (symbol === 'HttpClient' || symbol === '*'),
    )
  ) {
    if (!file.file.includes('/data-access/') && !isWithin(file.file, 'src/app/core/api')) {
      reject('api-client-boundary', 'Inject HTTP transport only in data-access/ or core/api/.');
    }
  }

  const from = ownerOf(file.file, features);
  const routesMayChooseLayout =
    routeFile(file.file) && features.some(({ root }) => root === dirname(file.file));
  const paths = [target, ...origins.map((origin) => origin.file)].filter((path): path is string =>
    Boolean(path),
  );
  if (
    from.startsWith('core/') &&
    paths.some(
      (path) =>
        isWithin(path, 'src/app/features') ||
        isWithin(path, 'src/app/layouts') ||
        isWithin(path, 'src/app/shared'),
    )
  ) {
    reject(
      'layer-boundary',
      'Core infrastructure cannot depend on features, layouts or shared primitives.',
    );
  }
  if (from.startsWith('shared/')) {
    if (
      origins.some(
        ({ external }) => external === UI_PACKAGE || external?.startsWith(`${UI_PACKAGE}/`),
      )
    ) {
      reject('layer-boundary', 'Shared primitives are non-visual.');
    }
    if (
      origins.some(
        ({ file: origin }) =>
          origin !== undefined &&
          /src\/app\/(?:core|features|layouts)\//u.test(origin) &&
          (!origin.includes('/ports/') || isWithin(origin, 'src/app/layouts')),
      )
    ) {
      reject(
        'layer-boundary',
        'Shared primitives may depend only on published ports outside shared/.',
      );
    }
  }
  if (
    from.startsWith('layouts/') &&
    origins.some(
      ({ file: origin }) =>
        origin !== undefined &&
        isWithin(origin, 'src/app/features') &&
        !origin.includes('/ports/') &&
        !origin.includes('/ui/components/'),
    )
  ) {
    reject('layer-boundary', 'Layouts consume public feature ports or widgets.');
  }
  if (
    !from.startsWith('layouts/') &&
    !routesMayChooseLayout &&
    paths.some((path) => isWithin(path, 'src/app/layouts'))
  ) {
    reject('layer-boundary', 'Only owner-root feature routes may select a layout.');
  }
  if (!target) {
    if (ALIAS.test(edge.name)) reject('unresolved-import', `Cannot resolve ${edge.name}.`);
    return;
  }
  if (
    edge.name.startsWith('.') &&
    isWithin(target, APPLICATION_ROOT) &&
    ownerOf(target, features) !== from
  ) {
    reject('boundary-alias', 'Use the application aliases across concerns or layers.');
  }
  const targetFeature = features.find(({ root }) => isWithin(target, root));
  if (targetFeature && from !== targetFeature.owner) {
    const permitted = [...targetFeature.entries].some(
      ([entry, allowed]) =>
        entryFile(targetFeature, entry, project) === target && allowed.has(from),
    );
    if (!permitted) {
      reject(
        'feature-entry',
        `Use an entry published for ${from} in ${targetFeature.owner}/FEATURE.md.`,
      );
    }
  }
  if (
    target.includes('/ui/pages/') &&
    !isWithin(file.file, dirname(target)) &&
    !(routeFile(file.file) && edge.dynamic && targetFeature?.owner === from)
  ) {
    reject('page-boundary', 'Only the owning route may lazy-load a private page.');
  }
  if (
    target.includes('/data-access/adapters/') &&
    (!file.file.includes('/data-access/') ||
      edge.exported ||
      (targetFeature && targetFeature.owner !== from))
  ) {
    reject('adapter-boundary', 'DTO adapters stay inside their owning data-access implementation.');
  }
  if (isWithin(target, 'src/app/core') && ownerOf(target, features) !== from) {
    const targetConcern = ownerOf(target, features);
    if (
      target !== `src/app/${targetConcern}/index.ts` &&
      !/^src\/app\/core\/api\/(?:models|utils)\/index\.ts$/u.test(target)
    ) {
      reject('core-entry', 'Use the public entry of the core concern.');
    }
  }
}

function checkRoutes(
  file: ProjectFile,
  feature: Feature | undefined,
  findings: ArchitectureFinding[],
): void {
  const root = file.file === 'src/app/app.routes.ts';
  if (!root && dirname(file.file) !== feature?.root) {
    findings.push(
      report(file, 'route-ownership', 'Route entries belong at the root of their feature.'),
    );
  }
  const declarations = file.source.statements.flatMap(exportedNames);
  const name = `${basename(file.file, '.routes.ts').replaceAll('-', '_').toUpperCase()}_ROUTES`;
  const variable = file.source.statements.find(
    (statement): statement is ts.VariableStatement =>
      ts.isVariableStatement(statement) && exportedNames(statement).includes(name),
  );
  const route = variable?.declarationList.declarations[0];
  if (
    declarations.length !== 1 ||
    declarations[0] !== name ||
    !variable ||
    !route?.initializer ||
    (variable.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    !ts.isArrayLiteralExpression(route.initializer)
  ) {
    findings.push(
      report(
        file,
        'angular-naming',
        `Export a single ${name} route constant with an inline array.`,
      ),
    );
  }
  if (!root) return;
  for (const edge of file.edges) {
    if (
      !edge.typeOnly &&
      edge.target &&
      isWithin(edge.target, APPLICATION_ROOT) &&
      (!edge.dynamic || !routeFile(edge.target))
    ) {
      findings.push(
        report(
          file,
          'lazy-root-routes',
          'Root routes may only lazy-load feature route entries.',
          edge.node,
        ),
      );
    }
  }
  const allowedProperties = new Set(['path', 'pathMatch', 'redirectTo', 'loadChildren']);
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) &&
          allowedProperties.has(prop.name.text)
        )
          continue;
        findings.push(
          report(
            file,
            'lazy-root-routes',
            'Root routes declare only prefixes, redirects and lazy feature entries.',
            prop,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file.source);
}
