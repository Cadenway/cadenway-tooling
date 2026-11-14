import { basename, dirname } from 'node:path';
import ts from 'typescript';
import { applicationFindings } from './application.js';
import { exportedNames, symbolOrigins } from './exports.js';
import { isInternal, libraryFindings } from './library.js';
import {
  findCycles,
  isTestFile,
  isWithin,
  report,
  scanProject,
  type ArchitectureFinding,
  type Project,
  type ProjectFile,
} from './project.js';

export type { ArchitectureFinding } from './project.js';

export interface ArchitectureException {
  readonly file: string;
  readonly rule: string;
  readonly reason: string;
}

export interface AngularArchitectureOptions {
  readonly rootDir: string;
  readonly tsconfig: string;
  readonly profile: 'application' | 'library';
  readonly roots?: readonly string[];
  readonly exceptions?: readonly ArchitectureException[];
}

/** Checks authored Angular source without loading an Angular application or library. */
export function verifyAngularArchitecture(
  options: AngularArchitectureOptions,
): readonly ArchitectureFinding[] {
  const defaults = options.profile === 'application' ? ['src/app', 'tests'] : ['src'];
  const project = scanProject(options.rootDir, options.tsconfig, options.roots ?? defaults);
  if (project.files.size === 0) {
    throw new Error('No authored TypeScript files found in the configured architecture roots.');
  }
  const findings = [
    ...structureFindings(project, options.profile),
    ...findCycles(project),
    ...(options.profile === 'application'
      ? applicationFindings(project)
      : libraryFindings(project)),
  ];
  const exceptions = new Set<string>();
  for (const exception of options.exceptions ?? []) {
    if (!exception.reason.trim() || !project.paths.has(exception.file)) {
      throw new Error(
        `Invalid architecture exception for ${exception.file}: a tracked path and reason are required.`,
      );
    }
    exceptions.add(`${exception.file}:${exception.rule}`);
  }
  return findings
    .filter(({ file, rule }) => !exceptions.has(`${file}:${rule}`))
    .sort(
      (first, second) =>
        first.file.localeCompare(second.file) ||
        first.line - second.line ||
        first.rule.localeCompare(second.rule),
    );
}

const KEBAB = /^[a-z\d]+(?:-[a-z\d]+)*$/u;
const FILE_NAME = /^[a-z\d]+(?:-[a-z\d]+)*(?:\.[a-z\d]+(?:-[a-z\d]+)*)+$/u;
const ROLE_BY_DECORATOR: Readonly<Record<string, string>> = {
  Component: 'component',
  Directive: 'directive',
  Pipe: 'pipe',
  Service: 'service',
  Injectable: 'service',
};

function structureFindings(
  project: Project,
  profile: AngularArchitectureOptions['profile'],
): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];
  for (const directory of project.directories) {
    if (basename(directory) === 'testing') {
      findings.push({
        file: directory,
        line: 1,
        rule: 'testing-directory',
        message: 'Colocate tests and helpers with their subject.',
      });
    }
    if (
      profile === 'application' &&
      isWithin(directory, 'src/app') &&
      !KEBAB.test(basename(directory))
    ) {
      findings.push({
        file: directory,
        line: 1,
        rule: 'angular-naming',
        message: 'Use kebab-case directory names.',
      });
    }
  }
  for (const file of project.files.values()) {
    if (!FILE_NAME.test(basename(file.file))) {
      findings.push(
        report(
          file,
          'angular-naming',
          'Use kebab-case file names with dot-separated role suffixes.',
        ),
      );
    }
    if (
      !isWithin(file.file, 'tests') &&
      /\.(?:spec|mock|fixture|harness)\.[cm]?ts$/u.test(file.file) &&
      !colocated(file.file, project.paths)
    ) {
      findings.push(
        report(
          file,
          /\.spec\.[cm]?ts$/u.test(file.file) ? 'spec-colocation' : 'test-helper-colocation',
          'Place the test file next to its subject and keep the subject name.',
        ),
      );
    }
    if (isTestFile(file.file) || isWithin(file.file, 'tests') || file.file.includes('/tests/'))
      continue;
    checkDynamicImports(file, findings);
    for (const edge of file.edges) {
      if (
        !edge.target &&
        edge.name.startsWith('.') &&
        !/\.(?:css|scss|json|html|svg)$/u.test(edge.name)
      ) {
        findings.push(
          report(
            file,
            'unresolved-import',
            `Cannot resolve ${edge.name} with the project tsconfig.`,
            edge.node,
          ),
        );
      }
      if (
        edge.target &&
        (isTestFile(edge.target) ||
          isWithin(edge.target, 'tests') ||
          edge.target.includes('/testing/'))
      ) {
        findings.push(
          report(
            file,
            'test-import',
            'Production modules cannot import test code or stories.',
            edge.node,
          ),
        );
      }
    }
    if (
      !isWithin(file.file, 'tests') &&
      (basename(file.file) === 'index.ts' || basename(file.file) === 'public-api.ts')
    ) {
      checkBarrel(file, project, profile, findings);
    }
    if (profile === 'application' && isWithin(file.file, 'src/app')) {
      checkDeclarations(project, file, findings);
    }
  }
  return findings;
}

function checkDynamicImports(file: ProjectFile, findings: ArchitectureFinding[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments.at(0);
      if (!argument || !ts.isStringLiteralLike(argument)) {
        findings.push(
          report(
            file,
            'dynamic-import',
            'Use a literal import target so the boundary can be verified.',
            node,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file.source);
}

function colocated(spec: string, paths: ReadonlySet<string>): boolean {
  const subject = spec.replace(/\.(?:spec|mock|fixture|harness)\.[cm]?ts$/u, '');
  const exact = ['.ts', '.mts', '.cts'].some((ext) => paths.has(`${subject}${ext}`));
  // A qualified behavior spec can extend the subject stem, e.g. time-entry-form.forms.spec.ts.
  const stem = basename(subject).split('.')[0];
  return (
    exact ||
    [...paths].some(
      (path) =>
        dirname(path) === dirname(spec) &&
        !isTestFile(path) &&
        path.endsWith('.ts') &&
        basename(path).split('.')[0] === stem,
    )
  );
}

function checkBarrel(
  file: ProjectFile,
  project: Project,
  profile: AngularArchitectureOptions['profile'],
  findings: ArchitectureFinding[],
): void {
  for (const statement of file.source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      (!statement.exportClause || ts.isNamespaceExport(statement.exportClause))
    ) {
      findings.push(report(file, 'public-export', 'Use named re-exports in barrels.', statement));
    }
    for (const symbol of exportedNames(statement)) {
      if (symbol === '*') continue;
      for (const { file: origin, symbol: original } of symbolOrigins(file, project, symbol)) {
        if (!origin) continue;
        if (
          isTestFile(origin) ||
          (profile === 'application' &&
            (origin.includes('/ui/pages/') ||
              origin.includes('/data-access/adapters/') ||
              isInternal(project, origin, original)))
        ) {
          findings.push(
            report(
              file,
              'public-export',
              `Barrel cannot expose the private symbol ${symbol}.`,
              statement,
            ),
          );
        }
      }
    }
  }
}

function checkDeclarations(
  project: Project,
  file: ProjectFile,
  findings: ArchitectureFinding[],
): void {
  if (
    /\.(?:module|enum|dto|page)\.ts$/u.test(file.file) ||
    /\/(?:types|constants)\.ts$/u.test(file.file)
  ) {
    findings.push(
      report(file, 'angular-naming', 'Use standalone declarations and concept-specific files.'),
    );
  }
  for (const statement of file.source.statements) {
    if (ts.isEnumDeclaration(statement)) {
      findings.push(
        report(
          file,
          'angular-naming',
          'Use literal unions or const catalogs for Angular models.',
          statement,
        ),
      );
    }
    if (
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      const name = statement.name?.text;
      if (
        name &&
        (!/^[A-Z][A-Za-z\d]*$/u.test(name) ||
          (ts.isInterfaceDeclaration(statement) && /^I[A-Z][a-z]/u.test(name)))
      ) {
        findings.push(
          report(
            file,
            'angular-naming',
            'Use PascalCase for type names and omit the interface prefix I.',
            statement,
          ),
        );
      }
    }
    if (ts.isClassDeclaration(statement)) {
      for (const decorator of ts.getDecorators(statement) ?? []) {
        const expression = decorator.expression;
        const decoratorName =
          ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
            ? expression.expression.text
            : undefined;
        const role =
          decoratorName && Object.hasOwn(ROLE_BY_DECORATOR, decoratorName)
            ? ROLE_BY_DECORATOR[decoratorName]
            : undefined;
        if (role && decoratorName && !file.file.endsWith(`.${role}.ts`)) {
          findings.push(
            report(
              file,
              'angular-naming',
              `Use the .${role}.ts suffix for ${decoratorName}.`,
              statement,
            ),
          );
        }
        if (decoratorName === 'NgModule') {
          findings.push(
            report(file, 'angular-naming', 'Application declarations are standalone.', statement),
          );
        }
        if (role === 'component' && ts.isCallExpression(expression)) {
          checkTemplate(project, file, expression, findings);
        }
        if (
          role === 'component' &&
          statement.name &&
          (statement.name.text.endsWith('Component') ||
            (file.file.includes('/ui/pages/') && !statement.name.text.endsWith('Page')))
        ) {
          findings.push(
            report(
              file,
              'angular-naming',
              'Name a component by role, using Page for routed pages.',
              statement,
            ),
          );
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer;
        if (
          value &&
          ts.isCallExpression(value) &&
          ts.isIdentifier(value.expression) &&
          value.expression.text === 'signalStore' &&
          !file.file.endsWith('.store.ts')
        ) {
          findings.push(
            report(file, 'angular-naming', 'Use the .store.ts suffix for SignalStores.', statement),
          );
        }
        checkVariable(file, declaration, findings);
      }
    }
  }
}

const TYPE_SUFFIXES: Readonly<Record<string, string>> = {
  CanActivateFn: 'guard',
  CanActivateChildFn: 'guard',
  CanDeactivateFn: 'guard',
  CanMatchFn: 'guard',
  ResolveFn: 'resolver',
  HttpInterceptorFn: 'interceptor',
  EnvironmentProviders: 'provider',
};

function checkVariable(
  file: ProjectFile,
  declaration: ts.VariableDeclaration,
  findings: ArchitectureFinding[],
): void {
  const type = declaration.type;
  const value = declaration.initializer;
  const typeName =
    type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)
      ? type.typeName.text
      : undefined;
  const role =
    typeName && Object.hasOwn(TYPE_SUFFIXES, typeName) ? TYPE_SUFFIXES[typeName] : undefined;
  const token =
    value &&
    ts.isNewExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === 'InjectionToken';
  if (token && !/\.(?:token|slot)\.ts$/u.test(file.file)) {
    findings.push(
      report(
        file,
        'angular-naming',
        'Use a .token.ts or .slot.ts file for injection tokens.',
        declaration,
      ),
    );
  }
  if (
    token &&
    ts.isIdentifier(declaration.name) &&
    !/^[A-Z][A-Z\d_]*$/u.test(declaration.name.text)
  ) {
    findings.push(
      report(file, 'angular-naming', 'Use uppercase snake case for injection tokens.', declaration),
    );
  }
  if (role && !file.file.endsWith(`.${role}.ts`)) {
    findings.push(
      report(file, 'angular-naming', `Use a .${role}.ts file for this declaration.`, declaration),
    );
  }
}

function checkTemplate(
  project: Project,
  file: ProjectFile,
  decorator: ts.CallExpression,
  findings: ArchitectureFinding[],
): void {
  const options = decorator.arguments.at(0);
  if (!options || !ts.isObjectLiteralExpression(options)) return;
  const expected = basename(file.file, '.ts') + '.html';
  for (const property of options.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isIdentifier(property.name) ||
      property.name.text !== 'templateUrl'
    )
      continue;
    if (
      !ts.isStringLiteralLike(property.initializer) ||
      property.initializer.text !== `./${expected}` ||
      !project.paths.has(`${dirname(file.file)}/${expected}`)
    ) {
      findings.push(
        report(
          file,
          'angular-naming',
          'External component templates share the component stem and directory.',
          property,
        ),
      );
    }
  }
}
