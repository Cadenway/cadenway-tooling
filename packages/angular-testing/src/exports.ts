import ts from 'typescript';
import type { ImportEdge, Project, ProjectFile } from './project.js';

export interface ExportOrigin {
  readonly file?: string;
  readonly external?: string;
  readonly symbol: string;
}

interface Binding {
  readonly exported: string;
  readonly original: string;
}

function bindingsOf(edge: ImportEdge): Binding[] {
  if (ts.isImportDeclaration(edge.node)) {
    const clause = edge.node.importClause;
    const bindings: Binding[] = clause?.name
      ? [{ exported: clause.name.text, original: 'default' }]
      : [];
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      bindings.push({ exported: named.name.text, original: '*' });
    } else if (named) {
      for (const element of named.elements) {
        bindings.push({
          exported: element.name.text,
          original: element.propertyName?.text ?? element.name.text,
        });
      }
    }
    return bindings;
  }
  if (ts.isExportDeclaration(edge.node)) {
    const clause = edge.node.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      return clause.elements.map((element) => ({
        exported: element.name.text,
        original: element.propertyName?.text ?? element.name.text,
      }));
    }
  }
  return [];
}

export function importOrigins(project: Project, edge: ImportEdge): ExportOrigin[] {
  const names = bindingsOf(edge).flatMap(({ original }) =>
    original === '*' && edge.target ? namesOf(project, edge.target) : [original],
  );
  return (names.length ? names : ['*']).flatMap((name) =>
    followEdge(project, edge, name, new Set()),
  );
}

function namesOf(project: Project, path: string): string[] {
  const file = project.files.get(path);
  return file ? [...file.source.statements].flatMap(exportedNames) : [];
}

export function exportedNames(statement: ts.Statement): string[] {
  if (ts.isExportDeclaration(statement)) {
    const clause = statement.exportClause;
    if (!clause || !ts.isNamedExports(clause)) return ['*'];
    return clause.elements.map((element) => element.name.text);
  }
  if (
    !ts.canHaveModifiers(statement) ||
    !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    return [];
  }
  if (
    ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  ) {
    return ['default'];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  }
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name ? [statement.name.text] : [];
  }
  return [];
}

export function symbolOrigins(file: ProjectFile, project: Project, symbol: string): ExportOrigin[] {
  return followExport(project, file.file, symbol, new Set());
}

function followEdge(
  project: Project,
  edge: ImportEdge,
  symbol: string,
  seen: ReadonlySet<string>,
): ExportOrigin[] {
  return edge.target
    ? followExport(project, edge.target, symbol, seen)
    : [{ external: edge.name, symbol }];
}

function followExport(
  project: Project,
  path: string,
  symbol: string,
  seen: ReadonlySet<string>,
): ExportOrigin[] {
  const key = `${path}:${symbol}`;
  if (seen.has(key)) return [];
  const visited = new Set(seen).add(key);
  const file = project.files.get(path);
  if (!file) return [{ file: path, symbol }];
  for (const statement of file.source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    const edge = file.edges.find((candidate) => candidate.node === statement);
    if (!clause && edge) {
      const resolved = followEdge(project, edge, symbol, visited);
      if (resolved.length) return resolved;
    }
    if (!clause || !ts.isNamedExports(clause)) continue;
    const binding = clause.elements.find((item) => item.name.text === symbol);
    if (!binding) continue;
    const original = binding.propertyName?.text ?? binding.name.text;
    if (edge) return followEdge(project, edge, original, visited);
    for (const imported of file.edges.filter((candidate) => !candidate.exported)) {
      const local = bindingsOf(imported).find((candidate) => candidate.exported === original);
      if (local) return followEdge(project, imported, local.original, visited);
    }
    return [{ file: path, symbol: original }];
  }
  return [{ file: path, symbol }];
}
