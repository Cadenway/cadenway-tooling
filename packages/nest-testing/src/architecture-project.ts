import { relative, resolve } from 'node:path';

import ts from 'typescript';

import { isStrictGenerated } from './architecture-strict.js';
import type { NestArchitectureOptions } from './architecture.js';

export type StrictArchitectureProfile = NestArchitectureOptions['profile'];

/**
 * Interface ImportEdge
 *
 * @description
 * Reference to a dependency as written in a source file.
 */
export interface ImportEdge {
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

  /** Whether this reference only imports TypeScript types. */
  readonly typeOnly: boolean;

  /** Whether the source uses a static import with explicit member names. */
  readonly namedImport: boolean;

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
export interface SourceUnit {
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
export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
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
export function lineOf(ast: ts.SourceFile, node: ts.Node): number {
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
export function readEdges(
  ast: ts.SourceFile,
  compiler: ts.CompilerOptions,
  onComputedReference?: (line: number) => void,
): readonly ImportEdge[] {
  const edges: ImportEdge[] = [];

  const add = (
    node: ts.Node | undefined,
    runtime: boolean,
    typeOnly = false,
    namedImport = false,
  ): void => {
    if (node && ts.isStringLiteralLike(node)) {
      const mode: ts.ResolutionMode = ts.getModeForUsageLocation(ast, node, compiler);
      edges.push({
        specifier: node.text,
        line: lineOf(ast, node),
        runtime,
        typeOnly,
        namedImport,
        mode,
      });
    }
  };

  const addCall = (call: ts.CallExpression, runtime: boolean): void => {
    const arg = call.arguments[0];
    if (arg && ts.isStringLiteralLike(arg)) add(arg, runtime);
    else onComputedReference?.(lineOf(ast, call));
  };

  const visit: (node: ts.Node) => void = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause: ts.ImportClause | undefined = node.importClause;
      const members: ts.NamedImportBindings | undefined = clause?.namedBindings;
      const runtime =
        clause?.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
        (!clause ||
          clause.name !== undefined ||
          !members ||
          ts.isNamespaceImport(members) ||
          members.elements.length === 0 ||
          members.elements.some((element) => !element.isTypeOnly));
      const namedImport =
        !clause?.name && !!members && ts.isNamedImports(members) && members.elements.length > 0;
      add(node.moduleSpecifier, runtime, !runtime, namedImport);
    } else if (ts.isExportDeclaration(node)) {
      const clause: ts.NamedExportBindings | undefined = node.exportClause;
      const runtime =
        !node.isTypeOnly &&
        (!clause ||
          ts.isNamespaceExport(clause) ||
          clause.elements.length === 0 ||
          clause.elements.some((element) => !element.isTypeOnly));
      add(node.moduleSpecifier, runtime, !runtime);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, false, true);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, !node.isTypeOnly, node.isTypeOnly);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) addCall(node, false);
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        addCall(node, true);
    }
    ts.forEachChild(node, visit);
  };

  visit(ast);
  return edges;
}

/**
 * Function isTest
 *
 * @description
 * Recognizes test sources and local doubles without loading them.
 *
 * @param {string} file - Repository-relative path.
 * @returns {boolean} Whether the file belongs to tests.
 */
export function isTest(file: string, checkScripts = false): boolean {
  return (
    TEST_FILE.test(file) ||
    TEST_FOLDER.test(file) ||
    (checkScripts && /\.(?:spec|test|int-spec|mock|fixture|harness)\.[cm]?[jt]s$/u.test(file))
  );
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
export function sourceFiles(
  options: NestArchitectureOptions,
  compiler: ts.CompilerOptions,
  strict: StrictArchitectureProfile | undefined,
): readonly SourceUnit[] {
  const directories: readonly string[] =
    options.profile === 'kit' ? ['packages'] : ['src', 'tests', 'test'];
  const includes: readonly string[] | undefined =
    options.profile === 'kit'
      ? strict === 'kit'
        ? ['*/src/**/*', '*/*.mjs', '*/*.cjs', '*/*.js']
        : ['*/src/**/*']
      : undefined;
  const extensions =
    strict === 'kit' ? ['.ts', '.mts', '.cts', '.mjs', '.cjs', '.js'] : ['.ts', '.mts', '.cts'];
  return directories
    .flatMap((directory) =>
      ts.sys
        .readDirectory(
          resolve(options.rootDir, directory),
          [...extensions],
          strict ? SOURCE_EXCLUDES.filter((entry) => entry !== '**/generated/**') : SOURCE_EXCLUDES,
          includes,
        )
        .filter((path) => strict || !/\.d\.[cm]?ts$/u.test(path))
        .filter(
          (path) =>
            !strict ||
            strict === 'kit' ||
            !isStrictGenerated(normalizePath(relative(options.rootDir, path)), strict),
        )
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
export function readCompilerOptions(options: NestArchitectureOptions): ts.CompilerOptions {
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

export function createImportResolver(
  rootDir: string,
  compiler: ts.CompilerOptions,
): (unit: SourceUnit, edge: ImportEdge) => string | undefined {
  const cache = ts.createModuleResolutionCache(
    rootDir,
    (path) => (ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()),
    compiler,
  );
  return (unit, edge) => {
    const resolved = ts.resolveModuleName(
      edge.specifier,
      unit.path,
      compiler,
      ts.sys,
      cache,
      undefined,
      edge.mode,
    ).resolvedModule;
    return resolved && normalizePath(relative(rootDir, resolved.resolvedFileName));
  };
}
