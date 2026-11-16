import { report, type ArchitectureFinding } from './diagnostics.js';
import { isTestFile, type Project, type ProjectFile } from './project.js';

export function findCycles(project: Project): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];
  const done = new Set<string>();
  const stack: string[] = [];
  const inStack = new Set<string>();
  const visit = (file: ProjectFile): void => {
    if (done.has(file.file)) return;
    inStack.add(file.file);
    stack.push(file.file);
    for (const edge of file.edges) {
      if (edge.typeOnly || edge.dynamic || !edge.target || isTestFile(edge.target)) continue;
      const target = project.files.get(edge.target);
      if (!target) continue;
      if (inStack.has(target.file)) {
        const chain = [...stack.slice(stack.indexOf(target.file)), target.file].join(' -> ');
        findings.push(report(file, 'execution-cycle', `Static import cycle: ${chain}`, edge.node));
      } else {
        visit(target);
      }
    }
    stack.pop();
    inStack.delete(file.file);
    done.add(file.file);
  };
  for (const file of project.files.values()) if (!isTestFile(file.file)) visit(file);
  return findings;
}
