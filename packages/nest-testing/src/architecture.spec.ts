import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import {
  verifyNestArchitecture,
  type ArchitectureFinding,
  type NestArchitectureOptions,
} from './architecture.js';

/**
 * Constant MODULE_DOC
 *
 * @description
 * Minimal declaration used by the module examples.
 *
 * @type {string}
 */
const MODULE_DOC: string =
  '# Module\n\n## Public entry points\n\n| Entry point | Consumers |\n| --- | --- |\n';

/**
 * Function withProject
 *
 * @description
 * Executes the verifier against isolated authored files and an inherited tsconfig.
 *
 * @param {Readonly<Record<string, string>>} sources - Relative fixture paths and contents.
 * @param {NestArchitectureOptions['profile']} profile - Active architecture profile.
 * @param {NestArchitectureOptions['exceptions']} exceptions - Exact exceptions under test.
 * @returns {readonly ArchitectureFinding[]} Collected violations.
 */
function withProject(
  sources: Readonly<Record<string, string>>,
  profile: NestArchitectureOptions['profile'] = 'service',
  exceptions: NestArchitectureOptions['exceptions'] = [],
): readonly ArchitectureFinding[] {
  const root: string = mkdtempSync(join(tmpdir(), 'cadenway-nest-architecture-'));
  const files: Readonly<Record<string, string>> = {
    'package.json': '{"type":"module"}',
    'tsconfig.json': '{"extends":"./tsconfig.base.json","include":["src/**/*.ts"]}',
    'tsconfig.base.json':
      '{"compilerOptions":{"module":"nodenext","paths":{"@demo/*":["./src/modules/demo/*"]}}}',
    ...sources,
  };
  try {
    for (const [name, content] of Object.entries(files)) {
      const path: string = resolve(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return verifyNestArchitecture({
      rootDir: root,
      tsconfig: 'tsconfig.json',
      profile,
      exceptions,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('checks the tooling package boundaries as shipped', () => {
  const rootDir: string = fileURLToPath(new URL('../../..', import.meta.url));
  expect(verifyNestArchitecture({ rootDir, tsconfig: 'tsconfig.json', profile: 'kit' })).toEqual(
    [],
  );
});

it('accepts a thin HTTP adapter, typed port and colocated specs', () => {
  const sources: Readonly<Record<string, string>> = {
    'src/modules/demo/MODULE.md': MODULE_DOC,
    'src/modules/demo/demo.module.ts': 'export class DemoModule {}',
    'src/modules/demo/domain/demo.ts': 'export class Demo {}',
    'src/modules/demo/domain/demo.spec.ts': "import { Demo } from './demo.js'; new Demo();",
    'src/modules/demo/application/ports/demo.port.ts':
      "import type { Demo } from '../../domain/demo.js'; export type DemoPort = () => Demo;",
    'src/modules/demo/application/queries/read-demo.ts':
      "import type { DemoPort } from '../ports/demo.port.js'; export const read = (port: DemoPort) => port();",
    'src/modules/demo/api/http/demo.controller.ts':
      "import { read } from '../../application/queries/read-demo.js'; export const route = read;",
    'src/modules/demo/infrastructure/persistence/demo.repository.ts':
      "import type { DemoPort } from '../../application/ports/demo.port.js'; import { Demo } from '../../domain/demo.js'; export const get: DemoPort = () => new Demo();",
    'test/read-demo.int-spec.ts': '',
  };

  expect(withProject(sources)).toEqual([]);
});

it('checks aliases, lazy imports and type-only references against the target layer', () => {
  const sources: Readonly<Record<string, string>> = {
    'src/modules/demo/MODULE.md': MODULE_DOC,
    'src/modules/demo/demo.module.ts': 'export class DemoModule {}',
    'src/modules/demo/domain/demo.ts': [
      "import type { Concrete } from '@demo/infrastructure/persistence/concrete.js';",
      "export type Repository = import('../infrastructure/persistence/concrete.js').Concrete;",
      "export const load = () => import('@demo/infrastructure/persistence/concrete.js');",
      "import type { Injectable } from '@nestjs/common';",
      'export type Types = [Concrete, Injectable];',
    ].join('\n'),
    'src/modules/demo/infrastructure/persistence/concrete.ts': 'export class Concrete {}',
    'src/modules/demo/api/http/barrel.ts':
      "export * from '../../infrastructure/persistence/concrete.js';",
  };

  const findings: readonly ArchitectureFinding[] = withProject(sources);

  expect(
    findings.filter((finding) => finding.rule === 'layer-direction').map((finding) => finding.line),
  ).toEqual([1, 1, 2, 3]);
  expect(findings.some((finding) => finding.rule === 'framework-free' && finding.line === 4)).toBe(
    true,
  );
  expect(findings.some((finding) => finding.rule === 'explicit-exports')).toBe(true);
});

it('requires a public entry declared by the owner for each intermodule consumer', () => {
  const variants: Readonly<Record<string, string>> = {
    'src/modules/demo/MODULE.md': MODULE_DOC + '| application/queries/read-demo | consumer |\n',
    'src/modules/demo/demo.module.ts': 'export class DemoModule {}',
    'src/modules/demo/application/queries/read-demo.ts': 'export const read = () => true;',
    'src/modules/consumer/MODULE.md': MODULE_DOC,
    'src/modules/consumer/consumer.module.ts': 'export class ConsumerModule {}',
    'src/modules/consumer/infrastructure/remote/demo.client.ts':
      "export { read } from '@demo/application/queries/read-demo.js';",
  };

  expect(withProject(variants)).toEqual([]);
  expect(
    withProject({
      ...variants,
      'src/modules/demo/MODULE.md':
        MODULE_DOC +
        '\n```md\n' +
        MODULE_DOC +
        '| application/queries/read-demo | consumer |\n```\n',
    }),
  ).toEqual([expect.objectContaining({ rule: 'intermodule-private', line: 1 })]);
});

it('reports eager cycles and production imports of test fixtures', () => {
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      'src/foo.ts': "export { x } from './bar.js';",
      'src/bar.ts': "export { x } from './foo.js'; export { f } from './foo.fixture.js';",
      'src/foo.fixture.ts': 'export const f = 42;',
      'src/wrong-folder/foo.spec.ts': '',
    },
    'gateway',
  );

  expect(findings.map((finding) => finding.rule).sort()).toEqual([
    'execution-cycle',
    'production-test-import',
    'spec-colocation',
  ]);
});

it('permits type-only and lazy dependencies without creating eager cycles', () => {
  expect(
    withProject(
      {
        'src/foo.ts':
          "import type { X } from './bar.js'; export type Y = X; export const lazy = () => import('./bar.js');",
        'src/bar.ts': "import './foo.js'; export interface X {}",
      },
      'gateway',
    ),
  ).toEqual([]);
});

it('enforces role suffixes and isolates concrete dependencies in a lightweight gateway', () => {
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      'src/BadName.ts':
        "import { Controller as Route } from '@nestjs/common'; import Redis from 'ioredis'; @Route() export class BadName {}",
      'src/presence/infrastructure/persistence/presence.repository.ts':
        "import Redis from 'ioredis'; export const RedisClient = Redis;",
    },
    'gateway',
  );

  expect(findings.map((finding) => finding.rule).sort()).toEqual([
    'adapter-dependency',
    'kebab-case',
    'nest-role-naming',
  ]);
});

it('rejects private kit package imports and accepts an exact reasoned exception', () => {
  const sources: Readonly<Record<string, string>> = {
    'packages/first/src/index.ts': "export { value } from '../../second/src/internal.js';",
    'packages/second/src/internal.ts': 'export const value = 1;',
  };
  const exception: NonNullable<NestArchitectureOptions['exceptions']>[number] = {
    file: 'packages/first/src/index.ts',
    rule: 'kit-package-private',
    reason: 'Known test fixture that demonstrates exact matching.',
  };

  expect(withProject(sources, 'kit')).toEqual([
    expect.objectContaining({ rule: 'kit-package-private' }),
  ]);
  expect(withProject(sources, 'kit', [exception])).toEqual([]);
  expect(() => withProject(sources, 'kit', [{ ...exception, reason: '' }])).toThrow('undocumented');
});

it('keeps lightweight gateway adapters behind their application even when imported through an alias', () => {
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      'tsconfig.base.json':
        '{"compilerOptions":{"module":"nodenext","paths":{"@presence/*":["./src/presence/*"]}}}',
      'src/presence/api/http/presence.controller.ts':
        "export { read } from '@presence/infrastructure/persistence/redis.repository.js';",
      'src/presence/infrastructure/persistence/redis.repository.ts':
        'export const read = () => true;',
    },
    'gateway',
  );

  expect(findings).toEqual([expect.objectContaining({ rule: 'layer-direction' })]);
});

it('flags service use cases that bypass business module ownership', () => {
  expect(withProject({ 'src/tasks/change-task-status.ts': '' })).toEqual([
    expect.objectContaining({ rule: 'service-layout' }),
  ]);
});

it('requires even a flat gateway route to call a generated client through an outgoing adapter', () => {
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      'src/routes/demo.controller.ts': "export { read } from '../clients/demo.js';",
      'src/clients/demo.ts': 'export const read = () => true;',
    },
    'gateway',
  );

  expect(findings).toEqual([expect.objectContaining({ rule: 'adapter-boundary' })]);
});
