# Angular architecture checks

`@cadenway/angular-testing/architecture` checks authored source using TypeScript module resolution.

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyAngularArchitecture } from '@cadenway/angular-testing/architecture';

test('application architecture', () => {
  assert.deepEqual(
    verifyAngularArchitecture({
      rootDir: process.cwd(),
      tsconfig: 'tsconfig.app.json',
      profile: 'application',
    }),
    [],
  );
});
```

Add that test to the repository's `test:architecture` script and run it through the quality gate and CI. Use the TypeScript configuration that defines the source aliases. Findings include checkout-relative paths, one-based line numbers, rule IDs and messages. Invalid project configuration throws an error.

The application profile defaults to `src/app` and `tests`. It checks application layers, feature contracts, dependency boundaries, transport and presentation placement, component and route conventions, and test layout. Angular ESLint checks selector conventions. The scanner resolves static imports, re-exports, type imports and literal dynamic imports against the supplied configuration. Cycle diagnostics apply to the static value import graph.

A feature's own `## Public entry points` section grants access to other owners. Specify an owner-relative path and a comma-separated list of consumer paths relative to `src/app/features/`, or the reserved consumer `app`. A layout consumer uses `layouts/<name>`. Use `.` for the feature's `index.ts`.

| Entry point    | Consumers |
| -------------- | --------- |
| `tasks.routes` | app       |
| `ports`        | spaces    |

The library profile defaults to `src`. Set `roots` to checkout-relative source directories, including the directory containing `ng-package.json` when checking ng-packagr entry points. The profile checks public APIs, entry-point boundaries and test layout. To check a generated-client package, point the profile at its authored source directory. Both profiles skip emitted declarations and directories named `generated`, `dist`, `node_modules`, `coverage`, `out-tsc`, `storybook-static`, `playwright-report`, `test-results` and dot-prefixed directories. Specs, fixtures, mocks, harnesses and stories are test code. Their dependency graphs are outside the production cycle check.

Each `exceptions` item identifies one checkout-relative `file`, a diagnostic `rule` ID and a `reason`. The design system uses this for the cross-component Angular Forms suite and its existing private Markdown exports. Pass libraries or applications separately when they use different TypeScript path mappings.
