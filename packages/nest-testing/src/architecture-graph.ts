import type { ArchitectureFinding } from './architecture.js';

/**
 * Interface GraphEdge
 *
 * @description
 * Eager execution edge between two files.
 */
export interface GraphEdge {
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
export function findCycles(
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
