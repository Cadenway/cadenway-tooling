import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

import ts from 'typescript';

interface PublicModule {
  readonly name: string;
  readonly root: string;
  readonly wiring: string;
}

interface PublicContractOptions {
  readonly rootDir: string;
  readonly profile: 'service' | 'gateway';
  readonly program: ts.Program;
  readonly modules: readonly PublicModule[];
  readonly report: (file: string, rule: string, message: string, line?: number) => void;
}

interface PublicEntryRow {
  readonly entry: string;
  readonly consumers: readonly string[];
  readonly line: number;
}

interface NamedExport {
  readonly symbol: ts.Symbol;
  readonly node: ts.ExportSpecifier;
  readonly typeOnly: boolean;
}

const PUBLIC_ENTRY = /^public\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u;
const PUBLIC_HEADER = /^\s*\|\s*Entry point\s*\|\s*Consumers\s*\|\s*$/u;
const TABLE_SEPARATOR = /^\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*$/u;

function repositoryPath(rootDir: string, path: string): string {
  return relative(rootDir, path).replaceAll('\\', '/');
}

function typeScriptLine(node: ts.Node): number {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Read the exact public table, ignoring fenced code samples. */
function publicEntryRows(doc: string): readonly PublicEntryRow[] {
  let inSection = false;
  let inTable = false;
  let fence = '';
  const rows: PublicEntryRow[] = [];
  const lines = doc.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (marker?.[1]) {
      if (!fence) fence = marker[1];
      else if (marker[1].startsWith(fence) && !marker[2]?.trim()) fence = '';
      continue;
    }
    if (fence) continue;

    if (/^#{1,2}\s/u.test(line)) {
      inSection = line.trim() === '## Public entry points';
      inTable = false;
      continue;
    }
    if (!inSection) continue;
    if (PUBLIC_HEADER.test(line)) {
      inTable = TABLE_SEPARATOR.test(lines[index + 1] ?? '');
      continue;
    }
    if (!inTable || TABLE_SEPARATOR.test(line)) continue;

    const row = /^\s*\|([^|]*)\|([^|]*)\|\s*$/u.exec(line);
    if (!row) {
      inTable = false;
      continue;
    }
    const entry = (row[1] ?? '').trim().replace(/^`([^`]+)`$/u, '$1');
    const consumers = (row[2] ?? '')
      .split(',')
      .map((consumer) => consumer.trim().replace(/^`([^`]+)`$/u, '$1'));
    rows.push({ entry, consumers, line: index + 1 });
  }
  return rows;
}

/** Resolve the consumers of an exact module-relative entry path. */
export function findStrictPublicConsumers(doc: string, entry: string): readonly string[] {
  const rows = publicEntryRows(doc).filter((row) => row.entry === entry);
  return rows.length === 1 ? (rows[0]?.consumers ?? []) : [];
}

function targetSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ts.Symbol | undefined {
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function namedExports(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  report: (node: ts.Node, message: string) => void,
): readonly NamedExport[] {
  const exports: NamedExport[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause) ||
      !statement.exportClause.elements.length
    ) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause)
        report(statement, 'Use only imports and explicit named re-exports in public entry files.');
      continue;
    }
    for (const node of statement.exportClause.elements) {
      const symbol = targetSymbol(checker, checker.getExportSpecifierLocalTargetSymbol(node));
      if (
        !symbol?.declarations?.length ||
        node.name.text === 'default' ||
        node.propertyName?.text === 'default'
      ) {
        report(node, `Export a resolvable named declaration instead of "${node.name.text}".`);
        continue;
      }
      exports.push({ symbol, node, typeOnly: statement.isTypeOnly || node.isTypeOnly });
    }
  }
  return exports;
}

function localOrigin(rootDir: string, symbol: ts.Symbol): string {
  const declaration = symbol.declarations?.[0];
  return declaration ? repositoryPath(rootDir, declaration.getSourceFile().fileName) : '';
}

function namedType(symbol: ts.Symbol): boolean {
  return Boolean(
    symbol.declarations?.some(
      (declaration) =>
        ts.isInterfaceDeclaration(declaration) ||
        ts.isTypeAliasDeclaration(declaration) ||
        (ts.isClassDeclaration(declaration) && declaration.name !== undefined) ||
        ts.isEnumDeclaration(declaration),
    ),
  );
}

function contractTypeFile(owner: PublicModule, operationRoot: string, origin: string): boolean {
  const operation = basename(operationRoot);
  return (
    origin === `${operationRoot}/${operation}.input.ts` ||
    origin === `${operationRoot}/${operation}.output.ts` ||
    origin.startsWith(`${owner.root}/application/models/`) ||
    origin.startsWith(`${owner.root}/application/projections/`)
  );
}

function inspectPublicTypes(
  rootDir: string,
  checker: ts.TypeChecker,
  runtime: NamedExport,
  types: readonly NamedExport[],
  report: (node: ts.Node, message: string) => void,
): void {
  const allowed = new Set(types.map((item) => item.symbol));
  const inspectedSymbols = new Set<ts.Symbol>();
  const inspectedTypes = new Set<ts.Type>();

  const inspectSymbol = (symbol: ts.Symbol | undefined, location: ts.Node): void => {
    const target = targetSymbol(checker, symbol);
    if (!target || inspectedSymbols.has(target)) return;
    const path = localOrigin(rootDir, target);
    if (!path.startsWith('src/') && !path.startsWith('packages/')) return;
    if (target.flags & ts.SymbolFlags.TypeParameter) return;

    inspectedSymbols.add(target);
    if (!allowed.has(target)) {
      report(
        location,
        `Public contract references private type or value "${target.name}" from ${path}. Export an approved contract type or map it at the boundary.`,
      );
      return;
    }
    for (const declaration of target.declarations ?? []) inspectSyntax(declaration);
    inspectType(checker.getDeclaredTypeOfSymbol(target), location);
  };

  // Syntax preserves aliases such as `type PrivateCode = string`, which can disappear
  // from the semantic type. Semantic traversal also covers inferred inputs and outputs.
  const inspectSyntax = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node))
      inspectSymbol(checker.getSymbolAtLocation(node.typeName), node);
    else if (ts.isExpressionWithTypeArguments(node))
      inspectSymbol(checker.getSymbolAtLocation(node.expression), node);
    else if (ts.isTypeQueryNode(node))
      inspectSymbol(checker.getSymbolAtLocation(node.exprName), node);
    else if (ts.isImportTypeNode(node) && node.qualifier)
      inspectSymbol(checker.getSymbolAtLocation(node.qualifier), node);
    else if (ts.isComputedPropertyName(node))
      inspectSymbol(checker.getSymbolAtLocation(node.expression), node);
    ts.forEachChild(node, inspectSyntax);
  };

  const inspectSignature = (signature: ts.Signature, location: ts.Node): void => {
    const declaration = signature.getDeclaration();
    if (declaration) {
      for (const parameter of declaration.typeParameters ?? []) inspectSyntax(parameter);
      for (const parameter of declaration.parameters) {
        if (parameter.type) inspectSyntax(parameter.type);
      }
      if (declaration.type) inspectSyntax(declaration.type);
    }
    for (const parameter of signature.getParameters())
      inspectType(checker.getTypeOfSymbolAtLocation(parameter, location), location);
    inspectType(signature.getReturnType(), location);
  };

  const inspectType = (type: ts.Type, location: ts.Node): void => {
    if (inspectedTypes.has(type)) return;
    inspectedTypes.add(type);
    if (type.aliasSymbol) inspectSymbol(type.aliasSymbol, location);
    for (const argument of type.aliasTypeArguments ?? []) inspectType(argument, location);
    const symbol = type.getSymbol();
    if (symbol && namedType(symbol)) inspectSymbol(symbol, location);
    if (type.isUnionOrIntersection()) {
      for (const member of type.types) inspectType(member, location);
    }
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint) inspectType(constraint, location);
    }
    if (!(type.flags & ts.TypeFlags.Object)) return;
    if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
      for (const argument of checker.getTypeArguments(type as ts.TypeReference))
        inspectType(argument, location);
    }
    const origin = symbol && localOrigin(rootDir, symbol);
    if (origin && (origin.startsWith('../') || origin.includes('node_modules/'))) return;

    for (const property of type.getProperties()) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? location;
      inspectType(checker.getTypeOfSymbolAtLocation(property, declaration), declaration);
    }
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()])
      inspectSignature(signature, location);
    for (const index of checker.getIndexInfosOfType(type)) inspectType(index.type, location);
  };

  for (const entry of types) inspectSymbol(entry.symbol, entry.node);
  const useCaseType = checker.getDeclaredTypeOfSymbol(runtime.symbol);
  const execute = useCaseType.getProperty('execute');
  if (!execute) {
    report(runtime.node, 'Expose a use case with a public execute method.');
    return;
  }

  const location = execute.valueDeclaration ?? execute.declarations?.[0] ?? runtime.node;
  const signatures = checker.getTypeOfSymbolAtLocation(execute, location).getCallSignatures();
  if (
    !signatures.length ||
    (ts.canHaveModifiers(location) &&
      ts
        .getModifiers(location)
        ?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.PrivateKeyword ||
            modifier.kind === ts.SyntaxKind.ProtectedKeyword,
        ))
  ) {
    report(runtime.node, 'Expose a use case with a public execute method.');
    return;
  }
  for (const signature of signatures) inspectSignature(signature, location);
}

function importedModuleDecorator(checker: ts.TypeChecker, expression: ts.Expression): boolean {
  const namespace = ts.isPropertyAccessExpression(expression) ? expression.expression : undefined;
  if (ts.isPropertyAccessExpression(expression) && expression.name.text !== 'Module') return false;
  const declaration = checker.getSymbolAtLocation(namespace ?? expression)?.declarations?.[0];
  if (!declaration || (!ts.isImportSpecifier(declaration) && !ts.isNamespaceImport(declaration)))
    return false;
  if (
    ts.isImportSpecifier(declaration) &&
    (declaration.propertyName ?? declaration.name).text !== 'Module'
  )
    return false;
  let parent: ts.Node = declaration;
  while (!ts.isImportDeclaration(parent) && parent.parent) parent = parent.parent;
  return (
    ts.isImportDeclaration(parent) &&
    ts.isStringLiteralLike(parent.moduleSpecifier) &&
    parent.moduleSpecifier.text === '@nestjs/common'
  );
}

function staticExpression(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  visited = new Set<ts.Node>(),
): ts.Expression {
  if (visited.has(expression)) return expression;
  visited.add(expression);
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  )
    return staticExpression(checker, expression.expression, visited);
  if (!ts.isIdentifier(expression)) return expression;
  const declaration = targetSymbol(
    checker,
    checker.getSymbolAtLocation(expression),
  )?.valueDeclaration;
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const
  )
    return staticExpression(checker, declaration.initializer, visited);
  return expression;
}

function propertyValue(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (
      !property.name ||
      (!ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name)) ||
      property.name.text !== name
    )
      continue;
    if (ts.isPropertyAssignment(property)) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
  }
  return undefined;
}

function nestExports(
  source: ts.SourceFile | undefined,
  checker: ts.TypeChecker,
): readonly { readonly symbol?: ts.Symbol; readonly node: ts.Node }[] {
  const exports: { symbol?: ts.Symbol; node: ts.Node }[] = [];
  const visitedArrays = new Set<ts.ArrayLiteralExpression>();
  const inspectArray = (expression: ts.Expression, origin: ts.Node = expression): void => {
    const resolved = staticExpression(checker, expression);
    if (!ts.isArrayLiteralExpression(resolved) || visitedArrays.has(resolved)) {
      exports.push({ node: origin });
      return;
    }
    visitedArrays.add(resolved);
    for (const node of resolved.elements) {
      if (ts.isSpreadElement(node)) {
        inspectArray(node.expression, node);
        continue;
      }
      const entry = staticExpression(checker, node);
      const token = ts.isObjectLiteralExpression(entry) ? propertyValue(entry, 'provide') : entry;
      const symbol = token && targetSymbol(checker, checker.getSymbolAtLocation(token));
      exports.push({ ...(symbol ? { symbol } : {}), node });
    }
    visitedArrays.delete(resolved);
  };

  for (const statement of source?.statements ?? []) {
    if (!ts.isClassDeclaration(statement)) continue;
    for (const decorator of ts.getDecorators(statement) ?? []) {
      const call = decorator.expression;
      if (
        !ts.isCallExpression(call) ||
        !importedModuleDecorator(checker, call.expression) ||
        !call.arguments[0]
      )
        continue;
      const metadata = staticExpression(checker, call.arguments[0]);
      if (
        !ts.isObjectLiteralExpression(metadata) ||
        metadata.properties.some(
          (property) =>
            ts.isSpreadAssignment(property) ||
            (property.name && ts.isComputedPropertyName(property.name)),
        )
      ) {
        exports.push({ node: metadata });
        continue;
      }
      const declared = propertyValue(metadata, 'exports');
      if (declared) inspectArray(declared);
    }
  }
  return exports;
}

function checkManifest(
  options: PublicContractOptions,
  owner: PublicModule,
  sources: ReadonlyMap<string, ts.SourceFile>,
  entries: readonly ts.SourceFile[],
  owners: ReadonlySet<string>,
): void {
  const file = `${owner.root}/MODULE.md`;
  const fullPath = resolve(options.rootDir, file);
  const rows = existsSync(fullPath) ? publicEntryRows(readFileSync(fullPath, 'utf8')) : [];
  const known = new Set<string>();
  const wiring = basename(owner.wiring, '.ts');
  for (const { entry, consumers, line } of rows) {
    if (entry === 'None' && consumers.length === 1 && consumers[0] === 'None' && rows.length === 1)
      continue;
    if (
      (!PUBLIC_ENTRY.test(entry) && entry !== wiring) ||
      !sources.has(`${owner.root}/${entry}.ts`) ||
      known.has(entry)
    ) {
      options.report(
        file,
        'strict-public-entry',
        `Declare each existing public/<area>/<operation> or ${wiring} once; found "${entry}".`,
        line,
      );
      continue;
    }
    known.add(entry);
    const invalid = consumers.filter(
      (consumer, index) =>
        !owners.has(consumer) || consumer === owner.name || consumers.indexOf(consumer) !== index,
    );
    if (invalid.length) {
      options.report(
        file,
        'strict-public-entry',
        `Entry "${entry}" needs unique consuming owner names from this repository; found ${invalid.map((item) => '"' + item + '"').join(', ')}.`,
        line,
      );
    }
  }
  for (const entry of entries) {
    const path = repositoryPath(options.rootDir, entry.fileName);
    const relativeEntry = path.slice(owner.root.length + 1, -3);
    if (!known.has(relativeEntry)) {
      options.report(
        path,
        'strict-public-entry',
        `Declare "${relativeEntry}" and its consuming owners in ${file}.`,
      );
    }
  }
}

function checkEntry(
  options: PublicContractOptions,
  owner: PublicModule,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): NamedExport | undefined {
  const file = repositoryPath(options.rootDir, source.fileName);
  const [, area, operation] = PUBLIC_ENTRY.exec(file.slice(owner.root.length + 1, -3)) ?? [];
  if (!area || !operation) return undefined;

  const error = (node: ts.Node, message: string): void =>
    options.report(file, 'strict-public-export', message, typeScriptLine(node));
  const operationRoots = ['commands', 'queries'].map(
    (kind) => `${owner.root}/application/use-cases/${kind}/${area}/${operation}`,
  );
  const guardFile =
    options.profile === 'gateway' && operation.endsWith('-guard')
      ? `${owner.root}/presentation/http/guards/${area}/${operation.slice(0, -6)}.guard.ts`
      : undefined;
  const exports = namedExports(source, checker, error);
  const runtime = exports.find((item) => {
    if (item.typeOnly || !item.symbol.declarations?.some(ts.isClassDeclaration)) return false;
    const origin = localOrigin(options.rootDir, item.symbol);
    // Gateway guard entries are reserved for HTTP guards. Presentation may import a
    // documented guard entry but cannot use its path to reach a foreign use case.
    if (guardFile)
      return (
        origin === guardFile &&
        checker.getDeclaredTypeOfSymbol(item.symbol).getProperty('canActivate') !== undefined
      );
    return operationRoots.some((root) => origin === `${root}/${operation}.use-case.ts`);
  });
  const caseRoot =
    runtime &&
    operationRoots.find(
      (root) => localOrigin(options.rootDir, runtime.symbol) === `${root}/${operation}.use-case.ts`,
    );
  const types: NamedExport[] = [];
  for (const item of exports) {
    if (item === runtime) continue;
    const origin = localOrigin(options.rootDir, item.symbol);
    if (
      caseRoot &&
      item.symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias) &&
      contractTypeFile(owner, caseRoot, origin)
    ) {
      types.push(item);
    } else {
      error(
        item.node,
        guardFile
          ? `Export only the HTTP guard from ${guardFile}; "${item.node.name.text}" comes from ${origin}.`
          : `Export only the owner’s ${operation} use case and its approved application contracts; "${item.node.name.text}" comes from ${origin}.`,
      );
    }
  }

  if (!runtime) {
    options.report(
      file,
      'strict-public-export',
      guardFile
        ? `Expose one named HTTP guard from ${guardFile}.`
        : 'Expose one named runtime use case for this public operation.',
    );
    return undefined;
  }
  if (!guardFile) {
    inspectPublicTypes(options.rootDir, checker, runtime, types, (node, message) => {
      options.report(
        repositoryPath(options.rootDir, node.getSourceFile().fileName),
        'strict-public-type',
        message,
        typeScriptLine(node),
      );
    });
  }
  return runtime;
}

/** Check that the documented public surface matches the TypeScript and Nest exports. */
export function verifyStrictPublicContracts(options: PublicContractOptions): void {
  const sources = new Map(
    options.program
      .getSourceFiles()
      .filter((source) => !source.isDeclarationFile)
      .map((source) => [repositoryPath(options.rootDir, source.fileName), source] as const),
  );
  const checker = options.program.getTypeChecker();
  const owners = new Set(options.modules.map((owner) => owner.name));
  const entriesByOwner = new Map<string, ts.SourceFile[]>();
  for (const [path, source] of sources) {
    if (!path.endsWith('.ts') || /\.(?:spec|int-spec|fixture)\.ts$/u.test(path)) continue;
    const owner = options.modules.find((candidate) => path.startsWith(`${candidate.root}/public/`));
    if (!owner) continue;
    const entries = entriesByOwner.get(owner.root) ?? [];
    entries.push(source);
    entriesByOwner.set(owner.root, entries);
  }

  for (const owner of options.modules) {
    const entries = entriesByOwner.get(owner.root) ?? [];
    checkManifest(options, owner, sources, entries, owners);
    const runtime = new Map<ts.Symbol, NamedExport>();
    for (const entry of entries) {
      const approved = checkEntry(options, owner, checker, entry);
      if (approved) runtime.set(approved.symbol, approved);
    }
    const registered = nestExports(sources.get(owner.wiring), checker);
    for (const [symbol, entry] of runtime) {
      if (!registered.some((item) => item.symbol === symbol)) {
        options.report(
          owner.wiring,
          'strict-public-nest-export',
          `Include "${entry.node.name.text}" in the @Module exports for ${owner.name}.`,
        );
      }
    }
    for (const item of registered) {
      if (item.symbol && runtime.has(item.symbol)) continue;
      options.report(
        repositoryPath(options.rootDir, item.node.getSourceFile().fileName),
        'strict-public-nest-export',
        item.symbol
          ? `Expose "${item.symbol.name}" through an approved public entry or remove it from @Module exports.`
          : 'Declare @Module exports with a static list of approved public providers.',
        typeScriptLine(item.node),
      );
    }
  }
}
