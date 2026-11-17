# Cadenway tooling

Owns development-only architecture and test helpers. Preserve npm package names and public
subpaths. Angular UI, icons, and tokens belong to the design system. Nest runtime belongs to the
service kit.

- Use pnpm with the committed lockfile and published cross-repository dependencies.
- Keep architecture checks static and independent of browser, framework, and container startup.
- Run `pnpm quality`. Add a Changeset for published package changes. CI handles releases.
- Check Markdown format and links for assistant documentation. Follow the
  [assistant code quality guide](docs/assistant-code-quality.md) for instruction sync.
- Never push to `main`, publish from an agent shell, or edit the generated lockfile by hand.

## Code quality

- Read the affected entry point, its callers, and its relevant tests before editing.
  Preserve the behavior callers rely on unless the task changes it.
- Keep the diff focused. Use names that express intent and reuse existing code when
  it preserves the required behavior. Extract code when it clarifies a responsibility.
- Keep business decisions with their owning module. Validate external inputs at the
  boundary and use documented public interfaces across modules and repositories.
- For writes that can fail, overlap, or be retried, verify the resulting state.
  Check transaction boundaries, tenant scope, and repeated delivery where relevant.
- For collections and repeated work, check what grows with input size. Measure or
  inspect the bottleneck before adding an index, cache, worker, or replica.
- Run the repository checks that cover the affected behavior. Report the commands
  and their results, including checks that did not run and tests that selected zero cases.
