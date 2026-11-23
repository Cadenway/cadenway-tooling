import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { report, type ArchitectureFinding } from './diagnostics.js';
import ts from 'typescript';
import { exportedNames, symbolOrigins } from './exports.js';
import { isTestFile, isWithin, posix, type Project } from './project.js';

interface Entry {
  readonly root: string;
  readonly file: string;
}

function libraryEntries(project: Project): Entry[] {
  return [...project.paths]
    .filter((path) => basename(path) === 'ng-package.json')
    .map((path) => {
      const root = dirname(path);
      const text = readFileSync(resolve(project.root, path), 'utf-8');
      const config: unknown = JSON.parse(text);
      const lib =
        typeof config === 'object' && config !== null && 'lib' in config ? config.lib : undefined;
      const entry =
        typeof lib === 'object' && lib !== null && 'entryFile' in lib ? lib.entryFile : undefined;
      return {
        root,
        file: posix(`${root}/${typeof entry === 'string' ? entry : 'src/public-api.ts'}`),
      };
    })
    .sort((first, second) => second.root.length - first.root.length);
}

export function libraryFindings(project: Project): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];
  const entries = libraryEntries(project);
  for (const entry of entries) {
    if (!project.files.has(entry.file) || basename(entry.file) !== 'public-api.ts') {
      findings.push({
        file: `${entry.root}/ng-package.json`,
        line: 1,
        rule: 'library-entry',
        message: 'A library entry must point to an authored public-api.ts.',
      });
    }
  }
  for (const directory of project.directories) {
    if (
      dirname(directory) === 'packages/ui/components' &&
      !entries.some(({ root }) => root === directory)
    ) {
      findings.push({
        file: directory,
        line: 1,
        rule: 'library-entry',
        message: 'Every UI brick has its own ng-package.json and public-api.ts.',
      });
    }
  }
  for (const file of project.files.values()) {
    if (isTestFile(file.file)) continue;
    const entry = entries.find(({ root }) => isWithin(file.file, root));
    for (const edge of file.edges) {
      if (edge.target === undefined) continue;
      const target = edge.target;
      const otherEntry = entries.find(({ root }) => isWithin(target, root));
      if (otherEntry && entry !== otherEntry && otherEntry.file !== target) {
        findings.push(
          report(
            file,
            'library-entry',
            'Import across package entry points through public-api.ts.',
            edge.node,
          ),
        );
      }
    }
    if (basename(file.file) !== 'public-api.ts') continue;
    for (const statement of file.source.statements) {
      for (const symbol of exportedNames(statement)) {
        for (const { file: origin, symbol: original } of symbolOrigins(file, project, symbol)) {
          if (!origin) continue;
          if (
            isTestFile(origin) ||
            /(?:^|\/)internal(?:\/|$)/u.test(origin) ||
            isInternal(project, origin, original)
          ) {
            findings.push(
              report(
                file,
                'public-export',
                `Public entry leaks internal or test symbol ${symbol}.`,
                statement,
              ),
            );
          }
          if (
            (symbol.startsWith('ɵ') || original.startsWith('ɵ')) &&
            (file.file !== 'packages/ui/core/public-api.ts' || !symbol.startsWith('ɵ'))
          ) {
            findings.push(
              report(
                file,
                'private-library-symbol',
                'Preserve the private ɵ prefix in the UI core entry only.',
                statement,
              ),
            );
          }
        }
      }
    }
  }
  return findings;
}

export function isInternal(project: Project, path: string, name: string): boolean {
  const file = project.files.get(path);
  return (
    file?.source.statements.some((statement) => {
      if (!exportedNames(statement).includes(name)) return false;
      return ts.getJSDocTags(statement).some((tag) => tag.tagName.text === 'internal');
    }) ?? false
  );
}
