import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export interface ProjectFile {
  readonly file: string;
  readonly absolute: string;
  readonly source: ts.SourceFile;
  readonly edges: readonly ImportEdge[];
}

export interface ImportEdge {
  readonly name: string;
  readonly target?: string;
  readonly node: ts.Node;
  readonly typeOnly: boolean;
  readonly dynamic: boolean;
  readonly exported: boolean;
}

export interface Project {
  readonly files: ReadonlyMap<string, ProjectFile>;
  readonly paths: ReadonlySet<string>;
  readonly directories: ReadonlySet<string>;
  readonly root: string;
}

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'generated',
  'coverage',
  'out-tsc',
  'storybook-static',
  'playwright-report',
  'test-results',
]);

export function isWithin(file: string, directory: string): boolean {
  return file === directory || file.startsWith(`${directory}/`);
}

export function posix(path: string): string {
  return path.split(sep).join('/');
}

function inside(path: string): boolean {
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function optionalDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export function scanProject(rootDir: string, tsconfig: string, roots: readonly string[]): Project {
  const root = realpathSync(rootDir);
  const configPath = resolve(root, tsconfig);
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: throwConfigError,
    },
  );
  if (!config) throw new Error(`Unable to parse TypeScript configuration: ${configPath}`);
  const configErrors = config.errors.filter((error) => error.code !== 18003);
  if (configErrors[0]) throwConfigError(configErrors[0]);

  const paths = new Set<string>();
  const directories = new Set<string>();
  const walk = (directory: string): void => {
    directories.add(posix(relative(root, directory)));
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (
        entry.isDirectory() &&
        !SKIPPED_DIRECTORIES.has(entry.name) &&
        !entry.name.startsWith('.')
      ) {
        walk(absolute);
      } else if (entry.isFile()) {
        paths.add(posix(relative(root, absolute)));
      }
    }
  };
  for (const item of roots) {
    const directory = resolve(root, item);
    if (!inside(relative(root, directory)))
      throw new Error(`Architecture root is outside the checkout: ${item}`);
    if (!optionalDirectory(directory)) continue;
    if (!inside(relative(root, realpathSync(directory)))) {
      throw new Error(`Architecture root resolves outside the checkout: ${item}`);
    }
    walk(directory);
  }

  const fileNames = [...paths].filter(
    (path) => /\.[cm]?tsx?$/u.test(path) && !/\.d\.[cm]?ts$/u.test(path),
  );
  const files = new Map<string, ProjectFile>();
  const moduleCache = ts.createModuleResolutionCache(
    root,
    (path) => (ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()),
    config.options,
  );
  for (const file of fileNames.sort()) {
    const absolute = resolve(root, file);
    const source = ts.createSourceFile(
      absolute,
      readFileSync(absolute, 'utf-8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const edges: ImportEdge[] = [];
    const add = (
      node: ts.Node,
      name: string,
      typeOnly: boolean,
      dynamic = false,
      exported = false,
    ): void => {
      const resolved = ts.resolveModuleName(
        name,
        absolute,
        config.options,
        ts.sys,
        moduleCache,
      ).resolvedModule;
      const path = resolved ? posix(relative(root, resolved.resolvedFileName)) : undefined;
      const target = path && !path.split('/').includes('node_modules') ? path : undefined;
      edges.push({ node, name, target, typeOnly, dynamic, exported });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const onlyTypes =
          clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
          (!clause?.name &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((item) => item.isTypeOnly));
        add(node, node.moduleSpecifier.text, Boolean(onlyTypes));
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        const clause = node.exportClause;
        const onlyTypes =
          node.isTypeOnly ||
          (clause &&
            ts.isNamedExports(clause) &&
            clause.elements.length > 0 &&
            clause.elements.every((item) => item.isTypeOnly));
        add(node, node.moduleSpecifier.text, Boolean(onlyTypes), false, true);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        add(node, node.argument.literal.text, true);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        const expression = node.moduleReference.expression;
        if (ts.isStringLiteralLike(expression)) add(node, expression.text, node.isTypeOnly);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const argument = node.arguments.at(0);
        if (argument && ts.isStringLiteralLike(argument)) {
          add(node, argument.text, false, node.expression.kind === ts.SyntaxKind.ImportKeyword);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    files.set(file, { file, absolute, source, edges });
  }
  return { files, paths, directories, root };
}

function throwConfigError(error: ts.Diagnostic): never {
  throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
}

export function isTestFile(file: string): boolean {
  return (
    /(?:^|\/)(?:__mocks__|__fixtures__)(?:\/|$)|\.(?:spec|test|mock|fixture|harness|stories)\.[cm]?tsx?$/u.test(
      file,
    ) || /(?:^|\/)test-setup\.[cm]?ts$/u.test(file)
  );
}
