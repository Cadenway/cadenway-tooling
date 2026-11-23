import ts from 'typescript';

type Report = (rule: string, message: string, line?: number) => void;
type Contract = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
type Declaration = Contract | ts.ClassDeclaration;
type ExportKind = 'type' | 'value';

const GENERIC_DIRECTORY = /^(?:utils?|helpers?|misc)$/u;
const GENERIC_FILE = /(?:^|[.-])(?:utils?|helpers?|misc)\./u;
const ROLE_FILE = /(?:^|\/)([^/.]+)\.(use-case|input|output|port|dto)\.ts$/u;

export function checkUtilityPath(file: string, report: Report): void {
  const segments = file.split('/');
  const name = segments.pop() ?? '';
  if (segments.some((segment) => GENERIC_DIRECTORY.test(segment)) || GENERIC_FILE.test(name)) {
    report(
      'strict-utility-path',
      'Name the file and directory after their responsibility and keep them in the owning layer.',
    );
  }
}

function lineOf(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function isContract(node: ts.Node): node is Contract {
  return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
}

/** Associates local declarations with their named exports, including local export lists. */
function namedDeclarations(
  source: ts.SourceFile,
): ReadonlyMap<Declaration, ReadonlyMap<string, ExportKind>> {
  const locals = new Map<string, Map<string, ExportKind>>();
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      const local = (element.propertyName ?? element.name).text;
      const names = locals.get(local) ?? new Map<string, ExportKind>();
      const name = element.name.text;
      const typeOnly = statement.isTypeOnly || element.isTypeOnly;
      if (!typeOnly || !names.has(name)) names.set(name, typeOnly ? 'type' : 'value');
      locals.set(local, names);
    }
  }

  const declarations = new Map<Declaration, ReadonlyMap<string, ExportKind>>();
  for (const statement of source.statements) {
    if ((!isContract(statement) && !ts.isClassDeclaration(statement)) || !statement.name) continue;
    const name = statement.name.text;
    const names = locals.get(name) ?? new Map<string, ExportKind>();
    const modifiers = ts.getModifiers(statement);
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      const isDefault = modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      );
      names.set(isDefault ? 'default' : name, isContract(statement) ? 'type' : 'value');
    }
    if (names.size) declarations.set(statement, names);
  }
  return declarations;
}

function hasPublicExecute(declaration: ts.ClassDeclaration): boolean {
  return declaration.members.some(
    (member) =>
      ts.isMethodDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      member.name.text === 'execute' &&
      member.body !== undefined &&
      !ts
        .getModifiers(member)
        ?.some(
          ({ kind }) =>
            kind === ts.SyntaxKind.StaticKeyword ||
            kind === ts.SyntaxKind.PrivateKeyword ||
            kind === ts.SyntaxKind.ProtectedKeyword,
        ),
  );
}

function roleNames(base: string, role: string): readonly string[] {
  switch (role) {
    case 'input':
      return [base + 'Input'];
    case 'output':
      return [base + 'Output'];
    case 'port':
      return [base, base + 'Port'];
    case 'dto':
      return [base, base + 'Dto'];
    default:
      return [base];
  }
}

export function checkFileDeclarations(source: ts.SourceFile, path: string, report: Report): void {
  const declarations = namedDeclarations(source);
  const contracts = [...declarations.keys()].filter(isContract);
  for (const extra of contracts.slice(1)) {
    report(
      'strict-contract-file',
      'Use one exported named type or interface per declaration file.',
      lineOf(extra, source),
    );
  }

  const roleFile = ROLE_FILE.exec(path);
  if (!roleFile) return;
  const [, stem = '', role] = roleFile;
  if (role === 'use-case' && contracts[0]) {
    report(
      'strict-contract-file',
      'Move exported use case contracts to their own .input.ts, .output.ts or model file.',
      lineOf(contracts[0], source),
    );
  }

  const candidates =
    role === 'use-case'
      ? [...declarations.keys()].filter(ts.isClassDeclaration)
      : [...declarations.keys()];
  const [declaration] = candidates;
  const requiresContract = role === 'port' || role === 'input' || role === 'output';
  if (
    candidates.length !== 1 ||
    !declaration ||
    (requiresContract && !isContract(declaration)) ||
    (role === 'port' && !ts.isInterfaceDeclaration(declaration))
  ) {
    const kind =
      role === 'use-case'
        ? 'class'
        : role === 'port'
          ? 'interface'
          : role === 'dto'
            ? 'class, type or interface'
            : 'type or interface';
    report(
      'strict-contract-file',
      `Declare and export exactly one ${kind} in this .${role}.ts file.`,
    );
    return;
  }

  const base = stem
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  const names = roleNames(base, role ?? '');
  const declaredName = declaration.name?.text;
  const kind = declaredName && declarations.get(declaration)?.get(declaredName);
  if (
    !declaredName ||
    !names.includes(declaredName) ||
    !kind ||
    (role === 'use-case' && kind !== 'value')
  ) {
    report(
      'strict-role-export',
      `Name and export the ${role} declaration as ${names.join(' or ')}.`,
      lineOf(declaration, source),
    );
  }
  if (role === 'use-case' && ts.isClassDeclaration(declaration) && !hasPublicExecute(declaration)) {
    report(
      'strict-use-case-execute',
      'Expose execute as a public instance method on the use case.',
      lineOf(declaration, source),
    );
  }
}
