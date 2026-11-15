import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import ts from 'typescript';

/**
 * Interface ArchitectureFinding
 *
 * @description
 * One source location that violates the architecture contract.
 */
export interface ArchitectureFinding {
  // #region Properties
  /**
   * Property file
   *
   * @description
   * Repository-relative path with forward slashes.
   *
   * @type {string}
   * @readonly
   */
  readonly file: string;

  /**
   * Property line
   *
   * @description
   * One-based source line.
   *
   * @type {number}
   * @readonly
   */
  readonly line: number;

  /**
   * Property rule
   *
   * @description
   * Stable rule name for CI and exceptions.
   *
   * @type {string}
   * @readonly
   */
  readonly rule: string;

  /**
   * Property message
   *
   * @description
   * Explanation of the violation.
   *
   * @type {string}
   * @readonly
   */
  readonly message: string;
  // #endregion
}

/**
 * Interface ArchitectureException
 *
 * @description
 * An explicit exception for one file and one rule.
 */
export interface ArchitectureException {
  // #region Properties
  /**
   * Property file
   *
   * @description
   * Exact repository-relative file path.
   *
   * @type {string}
   * @readonly
   */
  readonly file: string;

  /**
   * Property rule
   *
   * @description
   * Exact identifier of the rule being waived.
   *
   * @type {string}
   * @readonly
   */
  readonly rule: string;

  /**
   * Property reason
   *
   * @description
   * Why the exception is needed.
   *
   * @type {string}
   * @readonly
   */
  readonly reason: string;
  // #endregion
}

/**
 * Interface NestArchitectureOptions
 *
 * @description
 * Describes the repository and its architecture profile.
 */
export interface NestArchitectureOptions {
  // #region Properties
  /**
   * Property rootDir
   *
   * @description
   * Repository root.
   *
   * @type {string}
   * @readonly
   */
  readonly rootDir: string;

  /**
   * Property tsconfig
   *
   * @description
   * Absolute or root-relative TypeScript configuration path.
   *
   * @type {string}
   * @readonly
   */
  readonly tsconfig: string;

  /**
   * Property profile
   *
   * @description
   * Layered service, lightweight gateway or shared kit profile.
   *
   * @type {'service' | 'gateway' | 'kit'}
   * @readonly
   */
  readonly profile: 'service' | 'gateway' | 'kit';

  /**
   * Property exceptions
   *
   * @description
   * Reasoned exceptions identified by file and rule.
   *
   * @type {readonly ArchitectureException[]}
   * @readonly
   */
  readonly exceptions?: readonly ArchitectureException[];
  // #endregion
}

/**
 * Interface ImportEdge
 *
 * @description
 * Reference to a dependency as written in a source file.
 */
interface ImportEdge {
  // #region Properties
  /**
   * Property specifier
   *
   * @description
   * Module specifier as written.
   *
   * @type {string}
   * @readonly
   */
  readonly specifier: string;

  /**
   * Property line
   *
   * @description
   * One-based reference location.
   *
   * @type {number}
   * @readonly
   */
  readonly line: number;

  /**
   * Property runtime
   *
   * @description
   * Whether this can create an eager runtime dependency.
   *
   * @type {boolean}
   * @readonly
   */
  readonly runtime: boolean;

  /**
   * Property mode
   *
   * @description
   * TypeScript module resolution condition for the reference.
   *
   * @type {ts.ResolutionMode}
   * @readonly
   */
  readonly mode: ts.ResolutionMode;
  // #endregion
}

/**
 * Interface SourceUnit
 *
 * @description
 * One analyzed TypeScript file with its original AST.
 */
interface SourceUnit {
  // #region Properties
  /**
   * Property path
   *
   * @description
   * Absolute source path.
   *
   * @type {string}
   * @readonly
   */
  readonly path: string;

  /**
   * Property file
   *
   * @description
   * Normalized repository-relative path.
   *
   * @type {string}
   * @readonly
   */
  readonly file: string;

  /**
   * Property ast
   *
   * @description
   * Original TypeScript syntax tree.
   *
   * @type {ts.SourceFile}
   * @readonly
   */
  readonly ast: ts.SourceFile;
  // #endregion
}

/**
 * Interface ModuleOwner
 *
 * @description
 * A business module and the layer of an analyzed source file.
 */
interface ModuleOwner {
  // #region Properties
  /**
   * Property name
   *
   * @description
   * Folder name of the module.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property layer
   *
   * @description
   * Immediate folder or wiring file below the module root.
   *
   * @type {string}
   * @readonly
   */
  readonly layer: string;

  /**
   * Property root
   *
   * @description
   * Repository-relative folder that owns the source.
   *
   * @type {string}
   * @readonly
   */
  readonly root: string;
  // #endregion
}

/**
 * Constant MODULE_FILE
 *
 * @description
 * Captures the business module and immediate layer from a source path.
 *
 * @type {RegExp}
 */
const MODULE_FILE: RegExp = /^src\/modules\/([^/]+)\/([^/]+)(?:\/|$)/u;

/**
 * Constant KEBAB_PART
 *
 * @description
 * Portable casing for folder and file name segments.
 *
 * @type {RegExp}
 */
const KEBAB_PART: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Constant TEST_FILE
 *
 * @description
 * Test files and test-local fixtures, mocks and harnesses.
 *
 * @type {RegExp}
 */
const TEST_FILE: RegExp = /\.(?:spec|int-spec|mock|fixture|harness)\.[cm]?ts$/u;

/**
 * Constant TEST_FOLDER
 *
 * @description
 * Directories reserved for test-only sources.
 *
 * @type {RegExp}
 */
const TEST_FOLDER: RegExp = /(?:^|\/)(?:test|tests|testing)\//u;

/**
 * Constant ADAPTER_PACKAGE
 *
 * @description
 * Concrete database, broker, cache and remote clients.
 *
 * @type {RegExp}
 */
const ADAPTER_PACKAGE: RegExp =
  /^(?:drizzle-orm|pg|postgres|typeorm|@prisma\/client|ioredis|redis|meilisearch|nats|@nats-io\/[^/]+|axios|undici|@aws-sdk\/[^/]+)(?:\/|$)/u;

/**
 * Constant SOURCE_EXCLUDES
 *
 * @description
 * Directories that do not contain authored sources.
 *
 * @type {readonly string[]}
 */
const SOURCE_EXCLUDES: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/generated/**',
];

/**
 * Function normalizePath
 *
 * @description
 * Normalizes path separators for rules and diagnostics.
 *
 * @param {string} path - Path to normalize.
 * @returns {string} Slash-separated path.
 */
function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

/**
 * Function getLayer
 *
 * @description
 * Finds the owner and layer for a business module source.
 *
 * @param {string} file - Repository-relative path.
 * @param {NestArchitectureOptions['profile']} profile - Profile of the repository being checked.
 * @returns {ModuleOwner | undefined} Business module metadata, if applicable.
 */
function getLayer(
  file: string,
  profile: NestArchitectureOptions['profile'],
): ModuleOwner | undefined {
  const module: RegExpExecArray | null = MODULE_FILE.exec(file);
  const match: RegExpExecArray | null =
    module ?? (profile === 'gateway' ? CAPABILITY_FILE.exec(file) : null);
  const name: string | undefined = match?.[1];
  const layer: string | undefined = match?.[2];
  return name && layer
    ? { name, layer, root: module ? `src/modules/${name}` : `src/${name}` }
    : undefined;
}

/**
 * Function lineOf
 *
 * @description
 * Locates an AST reference in human-readable source coordinates.
 *
 * @param {ts.SourceFile} ast - Source tree.
 * @param {ts.Node} node - Reference node.
 * @returns {number} One-based line number.
 */
function lineOf(ast: ts.SourceFile, node: ts.Node): number {
  return ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
}

/**
 * Function readEdges
 *
 * @description
 * Reads static imports, named re-exports, import types and literal dynamic imports.
 *
 * @param {ts.SourceFile} ast - Source tree.
 * @param {ts.CompilerOptions} compiler - Repository module resolution configuration.
 * @returns {readonly ImportEdge[]} Direct dependency edges.
 */
function readEdges(ast: ts.SourceFile, compiler: ts.CompilerOptions): readonly ImportEdge[] {
  const edges: ImportEdge[] = [];

  const add: (node: ts.Node | undefined, runtime: boolean) => void = (node, runtime) => {
    if (node && ts.isStringLiteralLike(node)) {
      const mode: ts.ResolutionMode = ts.getModeForUsageLocation(ast, node, compiler);
      edges.push({ specifier: node.text, line: lineOf(ast, node), runtime, mode });
    }
  };

  const visit: (node: ts.Node) => void = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause: ts.ImportClause | undefined = node.importClause;
      const members: ts.NamedImportBindings | undefined = clause?.namedBindings;
      add(
        node.moduleSpecifier,
        clause?.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
          (!clause ||
            clause.name !== undefined ||
            !members ||
            ts.isNamespaceImport(members) ||
            members.elements.length === 0 ||
            members.elements.some((element) => !element.isTypeOnly)),
      );
    } else if (ts.isExportDeclaration(node)) {
      const clause: ts.NamedExportBindings | undefined = node.exportClause;
      add(
        node.moduleSpecifier,
        !node.isTypeOnly &&
          (!clause ||
            ts.isNamespaceExport(clause) ||
            clause.elements.length === 0 ||
            clause.elements.some((element) => !element.isTypeOnly)),
      );
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, false);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, !node.isTypeOnly);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0], false);
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        add(node.arguments[0], true);
    }
    ts.forEachChild(node, visit);
  };

  visit(ast);
  return edges;
}

/**
 * Function findPublicConsumers
 *
 * @description
 * Reads permissions from the owner's dedicated public entry points table.
 *
 * @param {string} doc - Contents of MODULE.md.
 * @param {string} entry - Module-relative target path.
 * @returns {readonly string[]} Consumer names for the requested entry.
 */
function findPublicConsumers(doc: string, entry: string): readonly string[] {
  let inSection: boolean = false;
  let inFence: boolean = false;
  let table: boolean = false;
  for (const line of doc.split(/\r?\n/u)) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^##\s+/u.test(line)) {
      inSection = line.trim() === '## Public entry points';
      table = false;
      continue;
    }
    if (!inSection) continue;
    if (/^\s*\|\s*Entry point\s*\|\s*Consumers\s*\|\s*$/u.test(line)) {
      table = true;
      continue;
    }
    if (!/^\s*\|/u.test(line)) table = false;
    if (!table) continue;
    const parts: string[] = line.split('|').map((part) => part.trim().replaceAll('`', ''));
    if (parts[1] !== entry && parts[1] !== entry.replace(/\/index$/u, '')) continue;
    return parts[2]?.split(',').map((part) => part.trim()) ?? [];
  }
  return [];
}

/**
 * Function layerAllows
 *
 * @description
 * Applies the within-module dependency direction.
 *
 * @param {string} source - Source layer or wiring file.
 * @param {string} target - Target layer or wiring file.
 * @param {string} path - Repository-relative target file.
 * @returns {boolean} Whether the reference is allowed.
 */
function layerAllows(source: string, target: string, path: string): boolean {
  if (source.endsWith('.module.ts') || source === target) return true;
  if (source === 'application') return target === 'domain';
  if (source === 'api') return target === 'application' && !path.includes('/application/ports/');
  if (source === 'infrastructure') {
    return (
      target === 'domain' || (target === 'application' && path.includes('/application/ports/'))
    );
  }
  return false;
}

/**
 * Constant NEST_CLASS_ROLES
 *
 * @description
 * Nest decorators and their required class file roles.
 *
 * @type {ReadonlyMap<string, string>}
 */
const NEST_CLASS_ROLES: ReadonlyMap<string, string> = new Map([
  ['Controller', 'controller'],
  ['Module', 'module'],
  ['WebSocketGateway', 'gateway'],
]);

/**
 * Constant CAPABILITY_FILE
 *
 * @description
 * Locates a gateway capability that uses architectural layers or a module wiring file.
 *
 * @type {RegExp}
 */
const CAPABILITY_FILE: RegExp =
  /^src\/([^/]+)\/(domain|application|api|infrastructure|[^/]+\.module\.ts)(?:\/|$)/u;

/**
 * Function isTest
 *
 * @description
 * Recognizes test sources and local doubles without loading them.
 *
 * @param {string} file - Repository-relative path.
 * @returns {boolean} Whether the file belongs to tests.
 */
function isTest(file: string): boolean {
  return TEST_FILE.test(file) || TEST_FOLDER.test(file);
}

/**
 * Function isLocalSpecifier
 *
 * @description
 * Identifies local relative or root-relative specifiers.
 *
 * @param {string} specifier - Module specifier.
 * @returns {boolean} Whether the written specifier addresses a local path.
 */
function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || isAbsolute(specifier);
}

/**
 * Function sourceFiles
 *
 * @description
 * Discovers authored sources even when a production tsconfig excludes tests.
 *
 * @param {NestArchitectureOptions} options - Repository profile and paths.
 * @param {ts.CompilerOptions} compiler - TypeScript configuration used to infer source module format.
 * @returns {readonly SourceUnit[]} Sources in deterministic order.
 */
function sourceFiles(
  options: NestArchitectureOptions,
  compiler: ts.CompilerOptions,
): readonly SourceUnit[] {
  const directories: readonly string[] = options.profile === 'kit' ? ['packages'] : ['src', 'test'];
  const includes: readonly string[] | undefined =
    options.profile === 'kit' ? ['*/src/**/*'] : undefined;
  return directories
    .flatMap((directory) =>
      ts.sys
        .readDirectory(
          resolve(options.rootDir, directory),
          ['.ts', '.mts', '.cts'],
          SOURCE_EXCLUDES,
          includes,
        )
        .filter((path) => !/\.d\.[cm]?ts$/u.test(path))
        .map((path) => ({
          path,
          file: normalizePath(relative(options.rootDir, path)),
          ast: ts.createSourceFile(
            path,
            ts.sys.readFile(path) ?? '',
            {
              languageVersion: ts.ScriptTarget.Latest,
              impliedNodeFormat: ts.getImpliedNodeFormatForFile(path, undefined, ts.sys, compiler),
            },
            true,
          ),
        })),
    )
    .sort((left, right) => left.file.localeCompare(right.file));
}

/**
 * Function readCompilerOptions
 *
 * @description
 * Loads inherited module-resolution options from the selected project.
 *
 * @param {NestArchitectureOptions} options - Repository profile and paths.
 * @returns {ts.CompilerOptions} Parsed compiler options, including path aliases.
 */
function readCompilerOptions(options: NestArchitectureOptions): ts.CompilerOptions {
  const path: string = resolve(options.rootDir, options.tsconfig);
  const config: ts.ParsedCommandLine | undefined = ts.getParsedCommandLineOfConfigFile(
    path,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic: ts.Diagnostic): never => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!config) throw new Error(`Cannot read TypeScript configuration ${path}`);
  const errors: readonly ts.Diagnostic[] = config.errors.filter(
    (diagnostic) => diagnostic.code !== 18003,
  );
  if (errors.length) {
    throw new Error(
      errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('\n'),
    );
  }
  return config.options;
}

/**
 * Function decoratorName
 *
 * @description
 * Resolves a Nest decorator's name without relying on its local alias.
 *
 * @param {ts.Decorator} decorator - Decorator attached to a declaration.
 * @param {ts.SourceFile} ast - Source that declares the import bindings.
 * @returns {string | undefined} Decorator name, if statically identifiable.
 */
function decoratorName(decorator: ts.Decorator, ast: ts.SourceFile): string | undefined {
  const expression: ts.Expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('@nestjs/')
    )
      continue;
    const bindings: ts.NamedImportBindings | undefined = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isIdentifier(expression) && ts.isNamedImports(bindings)) {
      const binding: ts.ImportSpecifier | undefined = bindings.elements.find(
        (member) => member.name.text === expression.text,
      );
      if (binding) return binding.propertyName?.text ?? binding.name.text;
    } else if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      ts.isNamespaceImport(bindings) &&
      bindings.name.text === expression.expression.text
    ) {
      return expression.name.text;
    }
  }
  return undefined;
}

/**
 * Type Report
 *
 * @description
 * Adds a diagnostic for the current source unit.
 *
 * @type {(rule: string, message: string, line?: number) => void}
 */
type Report = (rule: string, message: string, line?: number) => void;

/**
 * Function checkFile
 *
 * @description
 * Checks file ownership, naming and spec colocation.
 *
 * @param {SourceUnit} unit - Source being reviewed.
 * @param {ModuleOwner | undefined} owner - Business module ownership, if applicable.
 * @param {ReadonlySet<string>} fileNames - All authored source paths.
 * @param {NestArchitectureOptions} options - Repository profile and paths.
 * @param {Report} report - Finding collector for the current file.
 */
function checkFile(
  unit: SourceUnit,
  owner: ModuleOwner | undefined,
  fileNames: ReadonlySet<string>,
  options: NestArchitectureOptions,
  report: Report,
): void {
  const parts: readonly string[] = unit.file.split('/');
  if (parts.some((segment) => segment.split('.').some((part) => !KEBAB_PART.test(part)))) {
    report('kebab-case', 'Use lowercase kebab-case for file and directory name segments.');
  }

  if (/\.(?:spec|int-spec)\.[cm]?ts$/u.test(unit.file) && !unit.file.startsWith('test/')) {
    const subject: string = unit.file.replace(/\.(?:spec|int-spec)(?=\.[cm]?ts$)/u, '');
    if (!fileNames.has(subject)) {
      report(
        'spec-colocation',
        `Place the spec next to its subject ${subject}, or use test/ for a cross-layer integration scenario.`,
      );
    }
  }
  if (unit.file.startsWith('test/') && /\.spec\.[cm]?ts$/u.test(unit.file)) {
    report('cross-layer-spec', 'Use the .int-spec.ts suffix for cross-layer tests in test/.');
  }

  if (!owner) {
    // The process entry points: `main.ts`, `migrate.ts` and `telemetry.ts`, which
    // `@cadenway/nest-common` has preloaded before the application (`node --import`).
    if (
      options.profile === 'service' &&
      unit.file.startsWith('src/') &&
      !/^src\/(?:app\.module\.ts$|main\.ts$|migrate\.ts$|telemetry\.ts$|config\/|health\/|infrastructure\/)/u.test(
        unit.file,
      )
    ) {
      report(
        'service-layout',
        'Place business handlers, domain logic, and use cases under src/modules/<module>/.',
      );
    }
    return;
  }
  if (
    owner.root.startsWith('src/modules/') &&
    !existsSync(resolve(options.rootDir, owner.root, 'MODULE.md'))
  ) {
    report('module-contract', `Module ${owner.name} needs a MODULE.md.`);
  }
  if (
    owner.root.startsWith('src/modules/') &&
    !fileNames.has(`${owner.root}/${owner.name}.module.ts`)
  ) {
    report('module-wiring', `Add ${owner.name}.module.ts at the root of the module.`);
  }
  const layer: string = owner.layer;
  if (
    layer !== `${owner.name}.module.ts` &&
    !['domain', 'application', 'api', 'infrastructure'].includes(layer)
  ) {
    report(
      'module-layout',
      'Place module sources in domain/, application/, api/ or infrastructure/.',
    );
  }
  if (unit.file.endsWith('.module.ts') && unit.file !== `${owner.root}/${owner.name}.module.ts`) {
    report('module-wiring', 'Keep Nest composition in the root <module>.module.ts file.');
  }
  if (isTest(unit.file)) return;

  if (
    unit.file.includes('/application/ports/') &&
    !unit.file.endsWith('.port.ts') &&
    !unit.file.endsWith('/index.ts')
  ) {
    report('port-naming', 'Name outgoing port contracts <name>.port.ts.');
  }
  if (
    unit.file.includes('/api/messaging/') &&
    !unit.file.endsWith('.handler.ts') &&
    !unit.file.endsWith('/index.ts')
  ) {
    report('handler-naming', 'Name incoming message handlers <name>.handler.ts.');
  }
  if (unit.file.endsWith('.controller.ts') && !unit.file.includes('/api/http/')) {
    report('adapter-placement', 'Keep HTTP controllers in api/http/.');
  }
  if (
    (unit.file.endsWith('.repository.ts') || unit.file.endsWith('.schema.ts')) &&
    !unit.file.includes('/infrastructure/persistence/')
  ) {
    report(
      'adapter-placement',
      'Keep repositories and ORM schemas in infrastructure/persistence/.',
    );
  }
  if (
    unit.file.includes('/infrastructure/persistence/') &&
    /(?:repository|schema)\.[cm]?ts$/u.test(unit.file) &&
    !/\.(?:repository|schema)\.ts$/u.test(unit.file)
  ) {
    report(
      'persistence-naming',
      'Use the role suffix .repository.ts or .schema.ts in persistence.',
    );
  }
  if (/\/application\/(?:commands|queries)\//u.test(unit.file)) {
    const base: string | undefined = parts.at(-1);
    if (base !== 'index.ts' && !/^\p{Ll}+-(?:[a-z0-9]+-)*[a-z0-9]+\.ts$/u.test(base ?? '')) {
      report(
        'use-case-naming',
        'Name the use case with an action and subject, for example change-task-status.ts.',
      );
    }
  }
}

/**
 * Function checkDeclaration
 *
 * @description
 * Checks class roles and framework usage from the parsed source.
 *
 * @param {SourceUnit} unit - Source being reviewed.
 * @param {ModuleOwner | undefined} owner - Business module ownership, if applicable.
 * @param {Report} report - Finding collector for the current file.
 */
function checkDeclaration(unit: SourceUnit, owner: ModuleOwner | undefined, report: Report): void {
  for (const statement of unit.ast.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      (!statement.exportClause || ts.isNamespaceExport(statement.exportClause))
    ) {
      report('explicit-exports', 'Use explicit named exports.', lineOf(unit.ast, statement));
    }
    if (!ts.isClassDeclaration(statement)) continue;
    const decorators: readonly ts.Decorator[] = ts.getDecorators(statement) ?? [];
    for (const decorator of decorators) {
      const name: string | undefined = decoratorName(decorator, unit.ast);
      const role: string | undefined = name ? NEST_CLASS_ROLES.get(name) : undefined;
      if (role && !unit.file.endsWith(`.${role}.ts`)) {
        report(
          'nest-role-naming',
          `Name this Nest declaration file <name>.${role}.ts.`,
          lineOf(unit.ast, decorator),
        );
      }
      if (owner?.layer === 'domain' || owner?.layer === 'application') {
        report(
          'framework-free',
          'Keep framework decorators outside domain and application.',
          lineOf(unit.ast, decorator),
        );
      }
    }
    if (
      owner?.layer === 'infrastructure' &&
      (statement.name?.text ?? '').endsWith('Repository') &&
      !unit.file.endsWith('.repository.ts')
    ) {
      report(
        'persistence-naming',
        'Name repository implementations <name>.repository.ts.',
        lineOf(unit.ast, statement),
      );
    }
  }
}

/**
 * Function checkIntermodule
 *
 * @description
 * Restricts access to entries published by the target module.
 *
 * @param {string} rootDir - Repository root.
 * @param {ModuleOwner} sourceOwner - Calling module.
 * @param {ModuleOwner} targetOwner - Owning module of the referenced file.
 * @param {string} target - Repository-relative target path.
 * @param {ImportEdge} edge - Source dependency.
 * @param {Report} report - Finding collector for the current file.
 */
function checkIntermodule(
  rootDir: string,
  sourceOwner: ModuleOwner,
  targetOwner: ModuleOwner,
  target: string,
  edge: ImportEdge,
  report: Report,
): void {
  const prefix: string = `${targetOwner.root}/`;
  const entry: string = target.slice(prefix.length).replace(/\.[cm]?ts$/u, '');
  const docPath: string = resolve(rootDir, prefix, 'MODULE.md');
  const consumers: readonly string[] = existsSync(docPath)
    ? findPublicConsumers(readFileSync(docPath, 'utf8'), entry)
    : [];
  const sourceIsInner: boolean =
    sourceOwner.layer === 'domain' || sourceOwner.layer === 'application';
  const targetIsPublic: boolean =
    targetOwner.layer === 'application'
      ? !entry.startsWith('application/ports/')
      : targetOwner.layer === `${targetOwner.name}.module.ts`;
  const sourceCanImport: boolean =
    !sourceIsInner && (!target.endsWith('.module.ts') || sourceOwner.layer.endsWith('.module.ts'));
  if (!targetIsPublic || !sourceCanImport || !consumers.includes(sourceOwner.name)) {
    report(
      'intermodule-private',
      `Module ${sourceOwner.name} cannot import ${target}. Use an authorized entry declared by ${targetOwner.name} in MODULE.md.`,
      edge.line,
    );
  }
}

/**
 * Function checkImport
 *
 * @description
 * Checks one dependency after resolving TypeScript aliases and package exports.
 *
 * @param {SourceUnit} unit - Source being reviewed.
 * @param {ModuleOwner | undefined} owner - Business module ownership, if applicable.
 * @param {ImportEdge} edge - Source dependency.
 * @param {string | undefined} target - Resolved repository-relative path, if any.
 * @param {NestArchitectureOptions} options - Repository profile and paths.
 * @param {Report} report - Finding collector for the current file.
 */
function checkImport(
  unit: SourceUnit,
  owner: ModuleOwner | undefined,
  edge: ImportEdge,
  target: string | undefined,
  options: NestArchitectureOptions,
  report: Report,
): void {
  const specifier: string = edge.specifier;
  const local: boolean =
    target !== undefined && !target.startsWith('../') && !/(?:^|\/)node_modules\//u.test(target);
  const targetOwner: ModuleOwner | undefined =
    local && target ? getLayer(target, options.profile) : undefined;
  const pure: boolean = owner?.layer === 'domain' || owner?.layer === 'application';

  if (isLocalSpecifier(specifier) && !target) {
    report(
      'unresolved-import',
      `Cannot resolve ${specifier} with the repository tsconfig.`,
      edge.line,
    );
  }
  if (
    target?.startsWith('../') &&
    (isLocalSpecifier(specifier) || !target.includes('/node_modules/'))
  ) {
    report(
      'repository-boundary',
      'Use a published package instead of importing files outside this repository.',
      edge.line,
    );
  }
  if (target && isTest(target)) {
    report(
      'production-test-import',
      `Production code imports test-only source ${target}.`,
      edge.line,
    );
  }
  if (specifier === '@cadenway/nest-testing' || specifier.startsWith('@cadenway/nest-testing/')) {
    report('production-test-import', 'Use nest-testing only from test sources.', edge.line);
  }

  if (options.profile === 'kit') {
    const sourcePackage: string | undefined = unit.file.split('/')[1];
    const targetPackage: string | undefined =
      local && target?.startsWith('packages/') ? target.split('/')[1] : undefined;
    const packageName: string = `@cadenway/${targetPackage ?? ''}`;
    if (
      targetPackage &&
      sourcePackage !== targetPackage &&
      specifier !== packageName &&
      !specifier.startsWith(`${packageName}/`)
    ) {
      report(
        'kit-package-private',
        'Use the public package name for imports between kit packages.',
        edge.line,
      );
    }
    return;
  }

  if (pure && (!local || !targetOwner)) {
    report(
      'framework-free',
      'Domain and application can only import from their own permitted module layers.',
      edge.line,
    );
  }

  if (
    local &&
    target &&
    owner?.layer === 'api' &&
    !targetOwner &&
    !target.startsWith('src/config/')
  ) {
    report(
      'adapter-boundary',
      `Call an application entry instead of importing ${target} from an incoming adapter.`,
      edge.line,
    );
  }

  if (
    options.profile === 'gateway' &&
    local &&
    target?.startsWith('src/clients/') &&
    !/\/infrastructure\/|^src\/(?:app\.module\.ts$|clients\/)/u.test(unit.file) &&
    !unit.file.endsWith('.module.ts')
  ) {
    report(
      'adapter-boundary',
      'Use an outgoing adapter when calling generated gateway clients.',
      edge.line,
    );
  }

  if (ADAPTER_PACKAGE.test(specifier)) {
    const permitted: boolean =
      owner?.layer === 'infrastructure' ||
      (!owner && /(?:^src\/(?:migrate\.ts$|clients\/)|\/infrastructure\/)/u.test(unit.file));
    if (!permitted) {
      report(
        'adapter-dependency',
        `Keep the concrete dependency ${specifier} in an outgoing adapter.`,
        edge.line,
      );
    }
  }

  if (!target || !targetOwner) return;
  if (!owner) {
    if (!(
      unit.file === 'src/app.module.ts' && targetOwner.layer === `${targetOwner.name}.module.ts`
    )) {
      report(
        'module-private',
        `Import only the module wiring from application composition, not ${target}.`,
        edge.line,
      );
    }
  } else if (owner.root !== targetOwner.root) {
    checkIntermodule(options.rootDir, owner, targetOwner, target, edge, report);
  } else if (!layerAllows(owner.layer, targetOwner.layer, target)) {
    report(
      'layer-direction',
      `${owner.layer} cannot import ${targetOwner.layer} (${target}).`,
      edge.line,
    );
  }
}

/**
 * Interface GraphEdge
 *
 * @description
 * Eager execution edge between two files.
 */
interface GraphEdge {
  // #region Properties
  /**
   * Property target
   *
   * @description
   * Referenced file.
   *
   * @type {string}
   * @readonly
   */
  readonly target: string;

  /**
   * Property line
   *
   * @description
   * Source line that references the target.
   *
   * @type {number}
   * @readonly
   */
  readonly line: number;
  // #endregion
}

/**
 * Function findCycles
 *
 * @description
 * Finds back edges in the eager execution graph.
 *
 * @param {ReadonlyMap<string, readonly GraphEdge[]>} graph - Resolved static dependency graph.
 * @param {ArchitectureFinding[]} findings - Diagnostics collected for this run.
 */
function findCycles(
  graph: ReadonlyMap<string, readonly GraphEdge[]>,
  findings: ArchitectureFinding[],
): void {
  const visiting: Set<string> = new Set<string>();
  const complete: Set<string> = new Set<string>();
  const chain: string[] = [];
  const visit: (file: string) => void = (file) => {
    if (complete.has(file)) return;
    visiting.add(file);
    chain.push(file);
    for (const edge of graph.get(file) ?? []) {
      if (visiting.has(edge.target)) {
        const cycle: string = [...chain.slice(chain.indexOf(edge.target)), edge.target].join(
          ' -> ',
        );
        findings.push({
          file,
          line: edge.line,
          rule: 'execution-cycle',
          message: `Static import cycle: ${cycle}`,
        });
      } else {
        visit(edge.target);
      }
    }
    chain.pop();
    visiting.delete(file);
    complete.add(file);
  };
  for (const file of graph.keys()) visit(file);
}

/**
 * Function verifyNestArchitecture
 *
 * @description
 * Checks the authored sources of a service, gateway or the shared kit.
 *
 * @param {NestArchitectureOptions} options - Repository root, tsconfig and architecture profile.
 * @returns {readonly ArchitectureFinding[]} Deterministically ordered findings for the caller's test.
 */
export function verifyNestArchitecture(
  options: NestArchitectureOptions,
): readonly ArchitectureFinding[] {
  const compiler: ts.CompilerOptions = readCompilerOptions(options);
  const sources: readonly SourceUnit[] = sourceFiles(options, compiler);
  if (!sources.length) throw new Error(`No authored sources found in ${options.rootDir}`);
  const fileNames: ReadonlySet<string> = new Set(sources.map((unit) => unit.file));
  const findings: ArchitectureFinding[] = [];
  const graph: Map<string, GraphEdge[]> = new Map<string, GraphEdge[]>();
  const cache: ts.ModuleResolutionCache = ts.createModuleResolutionCache(
    options.rootDir,
    (path) => (ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()),
    compiler,
  );

  for (const unit of sources) {
    const owner: ModuleOwner | undefined = getLayer(unit.file, options.profile);
    const report: Report = (rule, message, line = 1) => {
      findings.push({ file: unit.file, line, rule, message });
    };
    checkFile(unit, owner, fileNames, options, report);
    if (isTest(unit.file)) continue;
    checkDeclaration(unit, owner, report);
    const runtime: GraphEdge[] = [];
    for (const edge of readEdges(unit.ast, compiler)) {
      const resolved: ts.ResolvedModuleFull | undefined = ts.resolveModuleName(
        edge.specifier,
        unit.path,
        compiler,
        ts.sys,
        cache,
        undefined,
        edge.mode,
      ).resolvedModule;
      const target: string | undefined =
        resolved && normalizePath(relative(options.rootDir, resolved.resolvedFileName));
      checkImport(unit, owner, edge, target, options, report);
      if (target && edge.runtime && fileNames.has(target) && !isTest(target)) {
        runtime.push({ target, line: edge.line });
      }
    }
    graph.set(unit.file, runtime);
  }
  findCycles(graph, findings);

  const exceptions: readonly ArchitectureException[] = options.exceptions ?? [];
  for (const exception of exceptions) {
    if (
      !exception.reason.trim() ||
      !findings.some(
        (finding) => finding.file === exception.file && finding.rule === exception.rule,
      )
    ) {
      throw new Error(
        `Stale or undocumented architecture exception: ${exception.file} (${exception.rule})`,
      );
    }
  }
  return findings
    .filter(
      (finding) =>
        !exceptions.some(
          (exception) => exception.file === finding.file && exception.rule === finding.rule,
        ),
    )
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.rule.localeCompare(right.rule),
    );
}
