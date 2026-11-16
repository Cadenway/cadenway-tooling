import type ts from 'typescript';
import type { ProjectFile } from './project.js';

export interface ArchitectureFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

export function report(
  file: ProjectFile,
  rule: string,
  message: string,
  node?: ts.Node,
): ArchitectureFinding {
  const line = node
    ? file.source.getLineAndCharacterOfPosition(node.getStart(file.source)).line + 1
    : 1;
  return { file: file.file, line, rule, message };
}
