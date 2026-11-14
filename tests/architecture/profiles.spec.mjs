import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { verifyAngularArchitecture } from '@cadenway/angular-testing/architecture';

const FEATURE =
  '# Feature\n\n## Public entry points\n\n| Entry point | Consumers |\n| --- | --- |\n';

function check(t, sources, options = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'cw-angular-architecture-'));
  t.after(() => rmSync(rootDir, { force: true, recursive: true }));
  const files = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        module: 'preserve',
        paths: {
          '@features/*': ['./src/app/features/*'],
          '@core/*': ['./src/app/core/*'],
        },
      },
    }),
    ...sources,
  };
  for (const [file, contents] of Object.entries(files)) {
    const path = join(rootDir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return verifyAngularArchitecture({
    rootDir,
    tsconfig: 'tsconfig.json',
    profile: 'application',
    ...options,
  });
}

test('accepts owner-declared lazy routes, ports and colocated specs', (t) => {
  const findings = check(t, {
    'src/app/app.routes.ts':
      "export const APP_ROUTES = [{ path: 'first', loadChildren: () => import('@features/first/first.routes').then(m => m.FIRST_ROUTES) }];",
    'src/app/features/first/FEATURE.md': FEATURE + '| `first.routes` | app |\n',
    'src/app/features/first/first.routes.ts':
      "import type { Port } from '@features/second/ports'; export const FIRST_ROUTES = [];",
    'src/app/features/second/FEATURE.md': FEATURE + '| `ports` | first |\n',
    'src/app/features/second/ports/index.ts': "export type { Port } from './port.interface';",
    'src/app/features/second/ports/port.interface.ts': 'export interface Port {}',
    'src/app/features/second/ports/port.interface.spec.ts':
      "import type { Port } from './port.interface';",
  });
  assert.deepEqual(findings, []);
});

test('rejects a private alias, an eager route and an unpublished re-export', (t) => {
  const findings = check(t, {
    'src/app/app.routes.ts':
      "import { FIRST_ROUTES } from '@features/first/first.routes';\nexport const APP_ROUTES = [{ path: 'first', children: FIRST_ROUTES }];",
    'src/app/features/first/FEATURE.md': FEATURE + '| `first.routes` | app |\n',
    'src/app/features/first/first.routes.ts':
      "import type { Private } from '@features/second/private.type';\nexport const FIRST_ROUTES = [];",
    'src/app/features/first/index.ts':
      "export type { Private as Renamed } from '@features/second/private.type';",
    'src/app/features/second/FEATURE.md': FEATURE,
    'src/app/features/second/private.type.ts': 'export type Private = string;',
  });
  assert.ok(
    findings.some(
      ({ file, line, rule }) =>
        file === 'src/app/app.routes.ts' && line === 1 && rule === 'lazy-root-routes',
    ),
  );
  assert.ok(
    findings.some(
      ({ file, rule }) => file.endsWith('/first.routes.ts') && rule === 'feature-entry',
    ),
  );
  assert.ok(
    findings.some(({ file, rule }) => file.endsWith('/first/index.ts') && rule === 'feature-entry'),
  );
});

test('rejects test directories, misplaced specs, wrong component names and production test imports', (t) => {
  const findings = check(t, {
    'src/app/core/clock/testing/clock.spec.ts': 'export const test = 1;',
    'src/app/core/clock/clock.ts':
      "import { test } from './testing/clock.spec'; @Component({}) export class ClockComponent {}",
  });
  for (const expected of [
    'angular-naming',
    'spec-colocation',
    'test-import',
    'testing-directory',
  ]) {
    assert.ok(
      findings.some(({ rule }) => rule === expected),
      expected,
    );
  }
});

test('checks generated API access through aliases and named re-exports', (t) => {
  const findings = check(t, {
    'src/app/features/first/FEATURE.md': FEATURE,
    'src/app/features/first/state/order.store.ts': "import type { Order } from '../data-access';",
    'src/app/features/first/data-access/index.ts':
      "import type { Generated } from '@cadenway/api-client'; export type { Generated as Order };",
  });
  assert.ok(
    findings.some(
      ({ file, rule }) => file.endsWith('/order.store.ts') && rule === 'api-client-boundary',
    ),
  );
});

test('reports static cycles without counting explicit type imports', (t) => {
  const findings = check(t, {
    'src/app/core/clock/clock.ts':
      "import { getTime } from './get-time'; export const currentTime = getTime();",
    'src/app/core/clock/get-time.ts':
      "import { currentTime } from './clock'; export function getTime() { return currentTime; }",
    'src/app/core/clock/a.type.ts': "import type { B } from './b.type'; export type A = B;",
    'src/app/core/clock/b.type.ts': "import type { A } from './a.type'; export type B = A;",
  });
  assert.equal(findings.filter(({ rule }) => rule === 'execution-cycle').length, 1);
});

test('checks Angular declaration names, external templates and verifiable import targets', (t) => {
  const findings = check(t, {
    'src/app/core/clock/clock.component.ts':
      "@Component({templateUrl: './clock.html'}) export class Clock {}",
    'src/app/core/clock/clock.html': '',
    'src/app/core/clock/wrong.ts':
      "export const clockGuard: CanActivateFn = () => true; export const clock = new InjectionToken('clock');",
    'src/app/core/clock/broken.ts':
      "import './missing'; export function load(name) { return import(name); }",
    'src/app/core/clock/lowercase.type.ts': 'export type lowercase = string;',
  });
  assert.ok(
    findings.some(
      ({ file, message }) => file.endsWith('/clock.component.ts') && message.includes('template'),
    ),
  );
  assert.ok(
    findings.some(
      ({ file, message }) => file.endsWith('/wrong.ts') && message.includes('.guard.ts'),
    ),
  );
  assert.ok(
    findings.some(
      ({ file, message }) => file.endsWith('/wrong.ts') && message.includes('.token.ts'),
    ),
  );
  assert.ok(
    findings.some(
      ({ file, rule }) => file.endsWith('/lowercase.type.ts') && rule === 'angular-naming',
    ),
  );
  assert.ok(findings.some(({ rule }) => rule === 'unresolved-import'));
  assert.ok(findings.some(({ rule }) => rule === 'dynamic-import'));
});

test('rejects a library deep import and a test helper re-export', (t) => {
  const findings = check(
    t,
    {
      'src/ng-package.json': '{"lib":{"entryFile":"public-api.ts"}}',
      'src/public-api.ts':
        "export { helper } from './helper.fixture'; export { alias } from './alias';",
      'src/helper.fixture.ts': 'export const helper = true;',
      'src/alias.ts':
        "import { privateSymbol } from './brick/private'; export const alias = privateSymbol;",
      'src/brick/ng-package.json': '{"lib":{"entryFile":"public-api.ts"}}',
      'src/brick/public-api.ts': 'export {};',
      'src/brick/private.ts': 'export const privateSymbol = 1;',
    },
    { profile: 'library' },
  );
  assert.ok(findings.some(({ file, rule }) => file === 'src/alias.ts' && rule === 'library-entry'));
  assert.ok(
    findings.some(({ file, rule }) => file === 'src/public-api.ts' && rule === 'public-export'),
  );
});
