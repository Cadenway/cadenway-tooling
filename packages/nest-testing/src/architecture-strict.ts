import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';

import { findStrictPublicConsumers } from './architecture-public-contracts.js';

export type StrictProfile = 'service' | 'gateway';

type Layer =
  | 'domain'
  | 'application'
  | 'presentation'
  | 'infrastructure'
  | 'composition'
  | 'public'
  | 'wiring'
  | 'unknown';

export interface StrictOwner {
  readonly name: string;
  readonly root: string;
  readonly layer: Layer;
  readonly wiring: string;
}

export interface StrictImportEdge {
  readonly specifier: string;
  readonly line: number;
  readonly typeOnly: boolean;
  readonly namedImport: boolean;
}

type Report = (rule: string, message: string, line?: number) => void;

const LAYERS: ReadonlySet<string> = new Set([
  'domain',
  'application',
  'presentation',
  'infrastructure',
  'composition',
  'public',
]);

// Resolve the owner independently of the layer so a misspelling cannot hide source.
const SERVICE_OWNER = /^src\/modules\/([^/]+)\//u;
const NESTED_GATEWAY_OWNER = /^src\/((?:routes|aggregates|public|relays)\/[^/]+)\//u;
const GATEWAY_OWNER = /^src\/(auth|rate-limit|connection|presence)\//u;
const TECHNICAL_SOURCE =
  /^src\/(?:main\.ts$|app\.module\.ts$|telemetry\.ts$|(?:config|infrastructure|health)\/)/u;
const GATEWAY_TECHNICAL_SOURCE =
  /^src\/(?:(?:realtime|gateway)-application\.ts$|problems\/|clients\/(?:clients\.module\.ts|[^/]+\.client(?:\.(?:spec|int-spec|fixture|mock|harness))?\.ts)$)/u;
const SHARED_GATEWAY_PRESENTATION = /^src\/presentation\/http\/(?:mappers|middleware|session)\//u;
const SHARED_CLIENT = /^src\/clients\/[^/]+\.client\.ts$/u;
const CLIENT_MODULE = 'src/clients/clients.module.ts';
const BOOTSTRAP_COMPOSITION = /^src\/(?:app\.module|(?:gateway|realtime)-application)\.ts$/u;
const PUBLIC_OPERATION = /^public\/[^/]+\/[^/.]+\.ts$/u;
const PUBLIC_GATEWAY_GUARD = /^public\/[^/]+\/[^/.]+-guard\.ts$/u;
const OUTBOUND_PORT = /^application\/ports\/outbound\/[^/]+\/[^/]+\/[^/]+\.port\.ts$/u;
const LOCAL_TOKEN = /^composition\/tokens\/[^/]+\/[^/]+\.token\.ts$/u;
const APPLICATION_ENTRY =
  /^application\/(?:use-cases\/(?:commands|queries)\/[^/]+\/[^/]+\/[^/]+\.(?:use-case|input|output)\.ts|(?:models|projections)\/[^/]+\/[^/]+\.(?:model|projection)\.ts)$/u;
const REQUIRES_WIRING = /\.(?:controller|gateway|guard|handler|command)\.ts$/u;
const COMPOSITION_FILE = /\.(?:provider|token)\.ts$/u;
const GATEWAY_PERSISTENCE =
  /^(?:(?:drizzle-orm|pg|postgres|typeorm|@prisma\/client|pg-boss|@cadenway\/nest-jobs)(?:\/|$)|@cadenway\/nest-common\/database(?:\/|$)|@cadenway\/nest-messaging\/outbox(?:\/|$))/u;
const RAW_BROKER = /^(?:nats|@nats-io\/[^/]+)(?:\/|$)/u;
const RAW_JOB_QUEUE = /^pg-boss(?:\/|$)/u;
const COMPOSITION_ADAPTER =
  /^@cadenway\/(?:nest-common\/(?:database|redis)|nest-messaging\/outbox)(?:\/|$)/u;
const CONCRETE_ADAPTER =
  /^(?:drizzle-orm|pg|postgres|typeorm|@prisma\/client|ioredis|redis|@socket\.io\/redis-adapter|meilisearch|nats|@nats-io\/[^/]+|axios|undici|stripe|@aws-sdk\/[^/]+|@octokit\/[^/]+|@node-saml\/[^/]+|@simplewebauthn\/[^/]+|openid-client|otplib|nodemailer|handlebars|pg-boss|file-type|argon2|@cadenway\/nest-common\/(?:database|redis)|@cadenway\/nest-messaging\/outbox)(?:\/|$)/u;

const DOMAIN_ROLES: readonly RegExp[] = [
  /^domain\/aggregates\/[^/]+\/[^/]+\.(?:aggregate|entity)\.ts$/u,
  /^domain\/value-objects\/[^/]+\/[^/]+\.value-object\.ts$/u,
  /^domain\/policies\/[^/]+\/[^/]+\.policy\.ts$/u,
  /^domain\/events\/[^/]+\/[^/]+\.event\.ts$/u,
  /^domain\/errors\/[^/]+\/[^/]+\.error\.ts$/u,
];

const APPLICATION_ROLES: readonly RegExp[] = [
  /^application\/services\/[^/]+\/[^/]+\.service\.ts$/u,
  OUTBOUND_PORT,
  /^application\/models\/[^/]+\/[^/]+\.model\.ts$/u,
  /^application\/projections\/[^/]+\/[^/]+\.projection\.ts$/u,
  /^application\/mappers\/[^/]+\/[^/]+\.mapper\.ts$/u,
];

const PRESENTATION_ROLES: readonly RegExp[] = [
  /^presentation\/http\/controllers\/[^/]+\/[^/]+\.controller\.ts$/u,
  /^presentation\/http\/dto\/(?:input|output)\/[^/]+\/[^/]+\.dto\.ts$/u,
  /^presentation\/http\/mappers\/[^/]+\/[^/]+\.mapper\.ts$/u,
  /^presentation\/http\/validation\/[^/]+\/[^/]+\.(?:validator|validation|pipe)\.ts$/u,
  /^presentation\/http\/errors\/[^/]+\/[^/]+\.(?:error|problem|filter)\.ts$/u,
  /^presentation\/http\/guards\/[^/]+\/[^/]+\.guard\.ts$/u,
  /^presentation\/http\/webhooks\/[^/]+\/[^/]+\.(?:controller|dto|mapper|validator)\.ts$/u,
  /^presentation\/(?:messaging|jobs)\/handlers\/[^/]+\/[^/]+\.handler\.ts$/u,
  /^presentation\/websocket\/gateways\/[^/]+\/[^/]+\.gateway\.ts$/u,
  /^presentation\/cli\/commands\/[^/]+\/[^/]+\.command\.ts$/u,
];

const INFRASTRUCTURE_ROLES: readonly RegExp[] = [
  /^infrastructure\/persistence\/drizzle\/schemas\/[^/]+\/[^/]+\.schema\.ts$/u,
  /^infrastructure\/persistence\/drizzle\/mappers\/[^/]+\/[^/]+\.mapper\.ts$/u,
  /^infrastructure\/persistence\/drizzle\/repositories\/[^/]+\/[^/]+\.repository\.ts$/u,
  /^infrastructure\/persistence\/drizzle\/transactions\/[^/]+\/[^/]+\.(?:transaction|unit-of-work)\.ts$/u,
  /^infrastructure\/messaging\/(?:outbox|rebuild)\/[^/]+\/[^/]+\.(?:adapter|mapper)\.ts$/u,
  /^infrastructure\/jobs\/pg-boss\/[^/]+\/[^/]+\.adapter\.ts$/u,
  /^infrastructure\/adapters\/[^/]+\/.+\.ts$/u,
];

const COMPOSITION_ROLES: readonly RegExp[] = [
  LOCAL_TOKEN,
  /^composition\/providers\/(?:use-cases|adapters)\/[^/]+\/[^/]+\.provider\.ts$/u,
];

const ROLE_HINTS: Readonly<Partial<Record<Layer, string>>> = {
  domain: 'domain/<role>/<area>/<name>.<role>.ts',
  application:
    'application/use-cases/{commands,queries}/<area>/<operation>/<operation>.<role>.ts, application/ports/outbound/<concern>/<area>/<name>.port.ts, or application/{models,projections,mappers,services}/<area>/<name>.<role>.ts',
  presentation: 'presentation/<transport>/<role>/<area>/<name>.<role>.ts',
  infrastructure:
    'infrastructure/persistence/drizzle/<role>/<area>/, infrastructure/messaging/{outbox,rebuild}/<area>/, infrastructure/jobs/pg-boss/<area>/, or infrastructure/adapters/<integration>/',
  composition:
    'composition/tokens/<area>/<name>.token.ts or composition/providers/{use-cases,adapters}/<area>/<name>.provider.ts',
  public: 'public/<area>/<operation>.ts',
};

/** Finds the strict module boundary of an authored path. */
export function strictOwnerOf(file: string, profile: StrictProfile): StrictOwner | undefined {
  const match =
    profile === 'service'
      ? SERVICE_OWNER.exec(file)
      : (NESTED_GATEWAY_OWNER.exec(file) ?? GATEWAY_OWNER.exec(file));
  const name = match?.[1];
  if (!name) return undefined;

  const root = profile === 'service' ? `src/modules/${name}` : `src/${name}`;
  const wiring = `${root}/${name.split('/').at(-1)}.module.ts`;
  const tail = file.slice(root.length + 1);
  const first = tail.split('/')[0] ?? '';
  const layer =
    file === wiring
      ? 'wiring'
      : tail.includes('/') && LAYERS.has(first)
        ? (first as Layer)
        : 'unknown';
  return { name, root, wiring, layer };
}

/** True for generated sources managed by a known repository tool. */
export function isStrictGenerated(file: string, profile: StrictProfile): boolean {
  return profile === 'gateway' && file.startsWith('src/clients/generated/');
}

function isTechnicalSource(file: string, profile: StrictProfile): boolean {
  return (
    TECHNICAL_SOURCE.test(file) ||
    (profile === 'service'
      ? file === 'src/migrate.ts'
      : GATEWAY_TECHNICAL_SOURCE.test(file) ||
        SHARED_GATEWAY_PRESENTATION.test(file) ||
        isStrictGenerated(file, profile))
  );
}

function pathIn(file: string, owner: StrictOwner): string {
  return file.slice(owner.root.length + 1);
}

function isUseCaseRole(path: string): boolean {
  const match =
    /^application\/use-cases\/(?:commands|queries)\/[^/]+\/([^/]+)\/([^/]+)\.(?:use-case|input|output)\.ts$/u.exec(
      path,
    );
  return match !== null && match[1] === match[2];
}

function hasRolePath(path: string, layer: Layer): boolean {
  switch (layer) {
    case 'domain':
      return DOMAIN_ROLES.some((role) => role.test(path));
    case 'application':
      return isUseCaseRole(path) || APPLICATION_ROLES.some((role) => role.test(path));
    case 'presentation':
      return PRESENTATION_ROLES.some((role) => role.test(path));
    case 'infrastructure':
      return INFRASTRUCTURE_ROLES.some((role) => role.test(path));
    case 'composition':
      return COMPOSITION_ROLES.some((role) => role.test(path));
    case 'public':
      return PUBLIC_OPERATION.test(path);
    default:
      return true;
  }
}

function lineOf(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// Check declarations, not public named re-exports. A local declaration can be exported by alias.
function namedContracts(source: ts.SourceFile): readonly ts.Node[] {
  const exportedLocals = new Set<string>();
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedLocals.add((element.propertyName ?? element.name).text);
      }
    }
  }

  return source.statements.filter(
    (statement) =>
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      (exportedLocals.has(statement.name.text) ||
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)),
  );
}

function checkNamedContracts(source: ts.SourceFile, path: string, report: Report): void {
  const contracts = namedContracts(source);
  for (const extra of contracts.slice(1)) {
    report(
      'strict-contract-file',
      'Use one exported named type or interface per declaration file.',
      lineOf(extra, source),
    );
  }
  if (
    OUTBOUND_PORT.test(path) &&
    (contracts.length !== 1 || !contracts[0] || !ts.isInterfaceDeclaration(contracts[0]))
  ) {
    report(
      'strict-contract-file',
      'Declare and export exactly one interface for this outbound port.',
    );
  }
  if (isUseCaseRole(path) && path.endsWith('.use-case.ts') && contracts[0]) {
    report(
      'strict-contract-file',
      'Move exported use case contracts to their own .input.ts, .output.ts or model file.',
      lineOf(contracts[0], source),
    );
  }
}

/** Verifies structure and naming independently of module resolution. */
export function checkStrictSource(
  file: string,
  ast: ts.SourceFile,
  owner: StrictOwner | undefined,
  profile: StrictProfile,
  test: boolean,
  report: Report,
): void {
  if (!file.startsWith('src/')) return;

  if (!owner) {
    if (!isTechnicalSource(file, profile)) {
      const expected =
        profile === 'service' ? 'src/modules/<module>/' : 'a declared gateway capability folder';
      report('strict-ownership', `Place ${file} under ${expected}.`);
    } else if (!test && REQUIRES_WIRING.test(file) && !file.startsWith('src/health/')) {
      report(
        'strict-ownership',
        'Register application entry points inside their owning capability.',
      );
    }
    return;
  }

  const path = pathIn(file, owner);
  if (/\.module\.ts$/u.test(path) && owner.layer !== 'wiring') {
    report('module-wiring', `Keep Nest composition in ${owner.wiring}.`);
  }
  if (owner.layer === 'unknown') {
    report(
      'strict-layer',
      'Use an explicit domain/, application/, presentation/, infrastructure/, composition/ or public/ layer. Replace api/ with presentation/.',
    );
    return;
  }
  if (
    !test &&
    profile === 'gateway' &&
    (owner.layer === 'domain' ||
      /^infrastructure\/(?:persistence|messaging\/outbox|jobs\/pg-boss)\//u.test(path))
  ) {
    report(
      'strict-layer',
      'Domain, SQL persistence and transactional outbox or jobs belong to a service.',
    );
    return;
  }
  if (test) return;

  if (REQUIRES_WIRING.test(path) && owner.layer !== 'presentation') {
    report(
      'strict-layout',
      'Place incoming entry points in presentation/<transport>/<role>/<area>/.',
    );
  } else if (COMPOSITION_FILE.test(path) && owner.layer !== 'composition') {
    report('strict-layout', 'Place provider and token declarations in composition/.');
  } else if (path.startsWith('application/ports/') && !OUTBOUND_PORT.test(path)) {
    report(
      'strict-port',
      'Place ports in application/ports/outbound/<concern>/<area>/<name>.port.ts.',
    );
  } else if (!hasRolePath(path, owner.layer)) {
    report('strict-layout', `Place ${path} under ${ROLE_HINTS[owner.layer]}.`);
  }
  if (owner.layer !== 'public') checkNamedContracts(ast, path, report);
}

/** States whether an authored capability source belongs to the Nest component graph. */
export function needsStrictWiring(file: string, owner: StrictOwner): boolean {
  return owner.layer === 'composition' || owner.layer === 'public' || REQUIRES_WIRING.test(file);
}

function isComposition(layer: Layer): boolean {
  return layer === 'composition' || layer === 'wiring';
}

function isPure(layer: Layer | undefined): boolean {
  return layer === 'application' || layer === 'domain';
}

function packageAt(target: string | undefined): string {
  if (!target) return '';
  const marker = 'node_modules/';
  const index = target.lastIndexOf(marker);
  if (index < 0 || (index > 0 && target[index - 1] !== '/')) return '';
  return /^(?:@[^/]+\/)?[^/]+/u.exec(target.slice(index + marker.length))?.[0] ?? '';
}

function permitsSharedDependency(
  source: string,
  owner: StrictOwner | undefined,
  target: string,
  profile: StrictProfile,
): boolean {
  if (isStrictGenerated(target, profile)) return SHARED_CLIENT.test(source);
  if (profile === 'gateway' && target === CLIENT_MODULE) {
    return source === 'src/app.module.ts' || (owner !== undefined && isComposition(owner.layer));
  }
  if (profile === 'gateway' && SHARED_CLIENT.test(target)) {
    return (
      source === CLIENT_MODULE ||
      owner?.layer === 'infrastructure' ||
      (owner !== undefined && isComposition(owner.layer))
    );
  }
  if (!isTechnicalSource(target, profile)) return false;
  if (!owner) return isTechnicalSource(source, profile);
  if (profile === 'gateway' && target.startsWith('src/problems/')) {
    return owner.layer === 'presentation';
  }
  if (profile === 'gateway' && SHARED_GATEWAY_PRESENTATION.test(target)) {
    return owner.layer === 'presentation' || isComposition(owner.layer);
  }
  return (
    (target.startsWith('src/config/') || target.startsWith('src/infrastructure/')) &&
    (owner.layer === 'infrastructure' || isComposition(owner.layer))
  );
}

function permitsForeignDependency(
  source: StrictOwner,
  target: StrictOwner,
  entry: string,
  edge: StrictImportEdge,
  profile: StrictProfile,
): boolean {
  if (!edge.namedImport) return false;
  if (target.layer === 'wiring') return isComposition(source.layer) && !edge.typeOnly;
  if (target.layer !== 'public' || !PUBLIC_OPERATION.test(entry)) return false;
  return (
    source.layer === 'infrastructure' ||
    isComposition(source.layer) ||
    (profile === 'gateway' && source.layer === 'presentation' && PUBLIC_GATEWAY_GUARD.test(entry))
  );
}

function permitsLocalDependency(
  source: StrictOwner,
  target: StrictOwner,
  sourcePath: string,
  targetPath: string,
  edge: StrictImportEdge,
  profile: StrictProfile,
  mirrorPorts: Set<string>,
  report: Report,
): boolean {
  if (source.layer === 'wiring') return target.layer !== 'unknown';
  if (source.layer === 'composition')
    return target.layer !== 'unknown' && target.layer !== 'wiring';
  if (source.layer === 'public') {
    return (
      APPLICATION_ENTRY.test(targetPath) ||
      (profile === 'gateway' &&
        /^presentation\/http\/guards\/[^/]+\/[^/]+\.guard\.ts$/u.test(targetPath))
    );
  }
  if (target.layer === source.layer) return true;
  if (source.layer === 'application') return target.layer === 'domain';
  if (source.layer === 'infrastructure') {
    return (
      target.layer === 'domain' ||
      (target.layer === 'application' &&
        (OUTBOUND_PORT.test(targetPath) || (edge.typeOnly && APPLICATION_ENTRY.test(targetPath))))
    );
  }
  if (source.layer !== 'presentation') return false;
  if (APPLICATION_ENTRY.test(targetPath)) return true;

  // A route which only forwards a request can inject its own port, but cannot import its adapter.
  const mirror =
    profile === 'gateway' &&
    /^(?:routes|public)\//u.test(source.name) &&
    sourcePath.endsWith('.controller.ts');
  if (
    !mirror ||
    !((edge.typeOnly && OUTBOUND_PORT.test(targetPath)) || LOCAL_TOKEN.test(targetPath))
  ) {
    return false;
  }
  const name = targetPath
    .split('/')
    .at(-1)
    ?.replace(/\.(?:port|token)\.ts$/u, '');
  if (name) mirrorPorts.add(name);
  if (mirrorPorts.size > 1) {
    report(
      'strict-mirror-port',
      'A mirror controller can inject one outbound port. Move orchestration into an application use case.',
      edge.line,
    );
  }
  return true;
}

interface StrictImportOptions {
  readonly rootDir: string;
  readonly profile: StrictProfile;
  readonly source: string;
  readonly owner: StrictOwner | undefined;
  readonly edge: StrictImportEdge;
  readonly target: string | undefined;
  readonly mirrorPorts: Set<string>;
  readonly report: Report;
}

/** Checks one resolved dependency against the strict ownership and layer rules. */
export function checkStrictImport(options: StrictImportOptions): void {
  const { rootDir, profile, source, owner, edge, target, mirrorPorts, report } = options;
  const targetOwner = target ? strictOwnerOf(target, profile) : undefined;
  const local = target?.startsWith('src/') === true;
  const resolvedPackage = packageAt(target);
  const matchesPackage = (pattern: RegExp): boolean =>
    pattern.test(edge.specifier) || pattern.test(resolvedPackage);

  if (isPure(owner?.layer) && !targetOwner) {
    report(
      'framework-free',
      'Application and domain can only import from permitted layers of their own module.',
      edge.line,
    );
  }
  if (profile === 'gateway' && matchesPackage(GATEWAY_PERSISTENCE)) {
    report(
      'adapter-boundary',
      `Keep ${edge.specifier} in a service that owns SQL persistence.`,
      edge.line,
    );
  } else if (matchesPackage(RAW_BROKER)) {
    report(
      'adapter-boundary',
      'Use @cadenway/nest-messaging for NATS connections, subscriptions and publication.',
      edge.line,
    );
  } else if (matchesPackage(RAW_JOB_QUEUE)) {
    report('adapter-boundary', 'Use @cadenway/nest-jobs for pg-boss queue operations.', edge.line);
  } else if (
    matchesPackage(CONCRETE_ADAPTER) &&
    owner?.layer !== 'infrastructure' &&
    !(
      COMPOSITION_ADAPTER.test(edge.specifier) &&
      (owner
        ? isComposition(owner.layer)
        : BOOTSTRAP_COMPOSITION.test(source) || source.startsWith('src/config/'))
    ) &&
    !(
      !owner &&
      (source.startsWith('src/infrastructure/') ||
        source === 'src/migrate.ts' ||
        SHARED_CLIENT.test(source))
    )
  ) {
    report('adapter-boundary', `Keep ${edge.specifier} in an infrastructure adapter.`, edge.line);
  }

  if (!target || !local) return;
  if (!targetOwner) {
    if (!isPure(owner?.layer) && !permitsSharedDependency(source, owner, target, profile)) {
      report(
        'adapter-boundary',
        `Use an authorized technical adapter or capability entry instead of importing ${target}.`,
        edge.line,
      );
    }
    return;
  }

  if (!owner) {
    if (!(
      source === 'src/app.module.ts' &&
      targetOwner.layer === 'wiring' &&
      edge.namedImport &&
      !edge.typeOnly
    )) {
      report(
        'module-private',
        `The application composition may import only capability wiring, not ${target}.`,
        edge.line,
      );
    }
    return;
  }

  const entry = pathIn(target, targetOwner);
  if (owner.root !== targetOwner.root) {
    const manifest = resolve(rootDir, targetOwner.root, 'MODULE.md');
    const consumers = existsSync(manifest)
      ? findStrictPublicConsumers(readFileSync(manifest, 'utf8'), entry.replace(/\.ts$/u, ''))
      : [];
    if (
      !permitsForeignDependency(owner, targetOwner, entry, edge, profile) ||
      !consumers.includes(owner.name)
    ) {
      report(
        'intermodule-private',
        `Capability ${owner.name} cannot import ${target}. Use a named entry declared for ${owner.name} in ${targetOwner.root}/MODULE.md.`,
        edge.line,
      );
    }
    return;
  }

  if (
    !permitsLocalDependency(
      owner,
      targetOwner,
      pathIn(source, owner),
      entry,
      edge,
      profile,
      mirrorPorts,
      report,
    )
  ) {
    report(
      'layer-direction',
      `${owner.layer} cannot import ${target}. Follow the dependency direction of the capability layers.`,
      edge.line,
    );
  }
}
