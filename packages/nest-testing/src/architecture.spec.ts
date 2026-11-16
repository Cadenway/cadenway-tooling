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
 * @param {NestArchitectureOptions['convention']} convention - Explicitly selected convention.
 * @returns {readonly ArchitectureFinding[]} Collected violations.
 */
function withProject(
  sources: Readonly<Record<string, string>>,
  profile: NestArchitectureOptions['profile'] = 'service',
  exceptions: NestArchitectureOptions['exceptions'] = [],
  convention?: NestArchitectureOptions['convention'],
): readonly ArchitectureFinding[] {
  const root: string = mkdtempSync(join(tmpdir(), 'cadenway-nest-architecture-'));
  const files: Readonly<Record<string, string>> = {
    'package.json': '{"type":"module"}',
    'tsconfig.json': '{"extends":"./tsconfig.base.json","include":["src/**/*.ts"]}',
    'tsconfig.base.json':
      '{"compilerOptions":{"module":"nodenext","experimentalDecorators":true,"paths":{"@demo/*":["./src/modules/demo/*"]}}}',
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
      ...(convention ? { convention } : {}),
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
    'tests/read-demo.int-spec.ts': '',
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

const KIT: Readonly<Record<string, string>> = {
  'packages/nest-common/package.json': JSON.stringify({
    name: '@cadenway/nest-common',
    type: 'module',
    exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './database': { types: './dist/database/index.d.ts', default: './dist/database/index.js' },
      './register': './register.mjs',
    },
  }),
  'packages/nest-common/src/index.ts': "export const common = 'common';",
  'packages/nest-common/src/database/index.ts': "export const database = 'database';",
  'packages/nest-common/register.mjs': "export const register = 'register';",
  'packages/nest-messaging/package.json': JSON.stringify({
    name: '@cadenway/nest-messaging',
    type: 'module',
    exports: './dist/index.js',
    peerDependencies: { '@cadenway/nest-common': 'workspace:^' },
  }),
  'packages/nest-messaging/src/index.ts':
    "export { common } from '@cadenway/nest-common'; export { database } from '@cadenway/nest-common/database';",
  'packages/nest-jobs/package.json': JSON.stringify({
    name: '@cadenway/nest-jobs',
    type: 'module',
    exports: { '.': './dist/index.js' },
  }),
  'packages/nest-jobs/src/index.ts':
    "export { runtime } from './runtime/start.js'; export { provision } from './provisioning/setup.js';",
  'packages/nest-jobs/src/runtime/start.ts':
    "export { schema as runtime } from '../schema/version.js';",
  'packages/nest-jobs/src/provisioning/setup.ts':
    "export { schema as provision } from '../schema/version.js';",
  'packages/nest-jobs/src/schema/version.ts': 'export const schema = 3;',
};

it('resolves the declared strict kit entries before building any kit package', () => {
  expect(withProject(KIT, 'kit', [], 'strict')).toEqual([]);
});

it('rejects undeclared package entries, private aliases and dependencies in the reverse direction', () => {
  const findings = withProject(
    {
      ...KIT,
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          paths: {
            '@cadenway/nest-common': ['./packages/nest-common/src/private.js'],
          },
        },
      }),
      'packages/nest-common/package.json': JSON.stringify({
        name: '@cadenway/nest-common',
        type: 'module',
        exports: { '.': './dist/index.js' },
        dependencies: { '@cadenway/nest-jobs': 'workspace:^' },
      }),
      'packages/nest-common/src/index.ts': "export { runtime } from '@cadenway/nest-jobs';",
      'packages/nest-common/src/private.ts': 'export const common = 1;',
      'packages/nest-messaging/src/index.ts': [
        "export { common } from '@cadenway/nest-common';",
        "export { database } from '@cadenway/nest-common/database';",
        "export { common as internal } from '../../nest-common/src/private.js';",
      ].join('\n'),
    },
    'kit',
    [],
    'strict',
  );
  expect(findings).toEqual([
    expect.objectContaining({
      file: 'packages/nest-common/package.json',
      rule: 'kit-package-direction',
    }),
    expect.objectContaining({
      file: 'packages/nest-common/src/index.ts',
      rule: 'kit-package-direction',
    }),
    ...[1, 2, 3].map((line) =>
      expect.objectContaining({
        file: 'packages/nest-messaging/src/index.ts',
        line,
        rule: 'kit-package-private',
      }),
    ),
  ]);
});

it('requires messaging to declare common as a production dependency', () => {
  const findings = withProject(
    {
      ...KIT,
      'packages/nest-messaging/package.json': JSON.stringify({
        name: '@cadenway/nest-messaging',
        type: 'module',
        exports: './dist/index.js',
        devDependencies: { '@cadenway/nest-common': 'workspace:^' },
      }),
    },
    'kit',
    [],
    'strict',
  );
  expect(findings.map(({ rule }) => rule)).toEqual([
    'kit-package-dependency',
    'kit-package-dependency',
  ]);
});

it('rejects test-only code in the strict kit API and in a production module hook', () => {
  const findings = withProject(
    {
      ...KIT,
      'packages/nest-common/package.json': JSON.stringify({
        name: '@cadenway/nest-common',
        type: 'module',
        exports: {
          '.': './dist/index.js',
          './database': './dist/database/index.js',
          './fixtures': './dist/testing/database.js',
          './register': './register.mjs',
          './missing': './dist/missing.js',
        },
      }),
      'packages/nest-common/src/testing/database.ts': 'export const database = 1;',
      'packages/nest-common/src/index.ts': "export { database } from './testing/database.js';",
      'packages/nest-common/register.mjs': "export { token } from './token.test.mjs';",
      'packages/nest-common/token.test.mjs': 'export const token = 2;',
    },
    'kit',
    [],
    'strict',
  );
  expect(findings).toEqual([
    ...['./dist/missing.js', './dist/testing/database.js']
      .map((target) =>
        expect.objectContaining({
          file: 'packages/nest-common/package.json',
          rule: 'kit-package-export',
          message: expect.stringContaining(target),
        }),
      )
      .reverse(),
    ...['register.mjs', 'src/index.ts'].map((file) =>
      expect.objectContaining({
        file: `packages/nest-common/${file}`,
        rule: 'production-test-import',
      }),
    ),
  ]);
});

it('follows strict kit type and value imports across the internal runtime boundaries', () => {
  const findings = withProject(
    {
      ...KIT,
      'packages/nest-common/src/database/index.ts':
        "export { guard as database } from './lookup.js';",
      'packages/nest-common/src/database/lookup.ts':
        "export { guard } from '../auth/internal-token/internal-token.guard.js';",
      'packages/nest-common/src/auth/internal-token/internal-token.guard.ts':
        "export const guard = 'guard';",
      'packages/nest-jobs/src/runtime/start.ts':
        "import type { Schema } from '../schema/version.js'; export const runtime: Schema = 1;",
      'packages/nest-jobs/src/schema/version.ts': [
        "export type { Schema } from '../provisioning/setup.js';",
        'export const schema = 1;',
      ].join('\n'),
      'packages/nest-jobs/src/provisioning/setup.ts': [
        "export { schema as provision } from '../schema/version.js';",
        'export type Schema = number;',
      ].join('\n'),
    },
    'kit',
    [],
    'strict',
  );
  expect(findings).toEqual([
    expect.objectContaining({
      file: 'packages/nest-common/src/database/index.ts',
      rule: 'kit-database-auth-guard',
    }),
    expect.objectContaining({
      file: 'packages/nest-common/src/database/lookup.ts',
      rule: 'kit-database-auth-guard',
    }),
    expect.objectContaining({
      file: 'packages/nest-jobs/src/runtime/start.ts',
      rule: 'kit-runtime-provisioning',
    }),
  ]);
});

it('reports strict kit execution cycles and ignores type-only cycles', () => {
  const findings = withProject(
    {
      ...KIT,
      'packages/nest-common/src/left.ts':
        "export { right } from './right.js'; export const left = 1;",
      'packages/nest-common/src/right.ts': [
        "export { left } from './left.js';",
        "export type { Other } from './types.js';",
        'export type Value = number;',
        'export const right = 2;',
      ].join('\n'),
      'packages/nest-common/src/types.ts':
        "export type { Value } from './right.js'; export type Other = string;",
    },
    'kit',
    [],
    'strict',
  );
  expect(findings).toEqual([expect.objectContaining({ rule: 'execution-cycle' })]);
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

it('accepts the telemetry entry point that @cadenway/nest-common preloads, beside main and migrate', () => {
  // `node --import ./dist/telemetry.js dist/main.js`: started before anything else is imported.
  const entryPoints: Readonly<Record<string, string>> = {
    'src/main.ts': "import './app.module.js';",
    'src/app.module.ts': 'export class AppModule {}',
    'src/migrate.ts': 'export {};',
    'src/telemetry.ts':
      "import { startTelemetry } from '@cadenway/nest-common/telemetry';\n" +
      "startTelemetry({ service: 'task-service' });",
  };

  expect(withProject(entryPoints, 'service')).toEqual([]);
  expect(withProject(entryPoints, 'gateway')).toEqual([]);
  // Only those names: another top-level file of a service still belongs to a module.
  expect(withProject({ ...entryPoints, 'src/tracing.ts': 'export {};' }, 'service')).toEqual([
    expect.objectContaining({ file: 'src/tracing.ts', rule: 'service-layout' }),
  ]);
});

it('rejects the former telemetry exception as stale, so consumers remove it', () => {
  expect(() =>
    withProject({ 'src/telemetry.ts': 'export {};' }, 'service', [
      {
        file: 'src/telemetry.ts',
        rule: 'service-layout',
        reason: 'Process entry point preloaded before main.js.',
      },
    ]),
  ).toThrow('Stale or undocumented architecture exception: src/telemetry.ts (service-layout)');
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

const DEMO_QUERY: string = 'src/modules/demo/application/use-cases/queries/lifecycle/read-demo';
const DEMO_PUBLIC_ENTRY: string = 'src/modules/demo/public/lifecycle/read-demo.ts';
const DEMO_PUBLIC_EXPORTS: string = [
  "export { ReadDemo } from '../../application/use-cases/queries/lifecycle/read-demo/read-demo.use-case.js';",
  "export type { ReadDemoInput } from '../../application/use-cases/queries/lifecycle/read-demo/read-demo.input.js';",
  "export type { ReadDemoOutput } from '../../application/use-cases/queries/lifecycle/read-demo/read-demo.output.js';",
].join('\n');

const STRICT_SERVICE: Readonly<Record<string, string>> = {
  'src/modules/demo/MODULE.md':
    MODULE_DOC + '| demo.module | reports |\n| public/lifecycle/read-demo | reports |\n',
  'src/modules/demo/demo.module.ts': [
    "import { Module } from '@nestjs/common';",
    "import { readDemoProvider } from './composition/providers/use-cases/lifecycle/read-demo.provider.js';",
    "import { ReadDemo } from './public/lifecycle/read-demo.js';",
    "import { DemoController } from './presentation/http/controllers/demo/demo.controller.js';",
    '@Module({ controllers: [DemoController], providers: [readDemoProvider], exports: [ReadDemo] })',
    'export class DemoModule {}',
  ].join('\n'),
  'src/modules/demo/composition/providers/use-cases/lifecycle/read-demo.provider.ts': [
    "import { ReadDemo } from '../../../../application/use-cases/queries/lifecycle/read-demo/read-demo.use-case.js';",
    'export const readDemoProvider = { provide: ReadDemo, useFactory: () => new ReadDemo() };',
  ].join('\n'),
  'src/modules/reports/MODULE.md': MODULE_DOC,
  'src/modules/reports/reports.module.ts': [
    "import { Module } from '@nestjs/common';",
    "import { DemoModule } from '../demo/demo.module.js';",
    "import { DemoAdapter } from './infrastructure/adapters/demo/demo.adapter.js';",
    '@Module({ imports: [DemoModule], providers: [DemoAdapter] })',
    'export class ReportsModule {}',
  ].join('\n'),
  'src/modules/reports/infrastructure/adapters/demo/demo.adapter.ts': [
    "import { ReadDemo, type ReadDemoInput, type ReadDemoOutput } from '@demo/public/lifecycle/read-demo.js';",
    'export class DemoAdapter {',
    '  constructor(private readonly query: ReadDemo) {}',
    '  read(input: ReadDemoInput): ReadDemoOutput { return this.query.execute(input); }',
    '}',
  ].join('\n'),
  'src/modules/demo/presentation/http/controllers/demo/demo.controller.ts': [
    "import { Controller } from '@nestjs/common';",
    "import { ReadDemo } from '@demo/application/use-cases/queries/lifecycle/read-demo/read-demo.use-case.js';",
    '@Controller("demo") export class DemoController {',
    '  constructor(private readonly query: ReadDemo) {}',
    '  read(id: string) { return this.query.execute({ id }); }',
    '}',
  ].join('\n'),
  'src/modules/demo/application/ports/outbound/clock/lifecycle/demo-clock.port.ts':
    'export interface DemoClock { now(): Date; }',
  [`${DEMO_QUERY}/read-demo.input.ts`]: 'export interface ReadDemoInput { readonly id: string; }',
  [`${DEMO_QUERY}/read-demo.output.ts`]: 'export interface ReadDemoOutput { readonly id: string; }',
  'src/modules/demo/application/services/lifecycle/demo-reader.service.ts':
    'export function demoId(): string { return "demo"; }',
  [`${DEMO_QUERY}/read-demo.use-case.ts`]: [
    "import type { DemoClock } from '../../../../ports/outbound/clock/lifecycle/demo-clock.port.js';",
    "import type { ReadDemoInput } from './read-demo.input.js';",
    "import type { ReadDemoOutput } from './read-demo.output.js';",
    'export class ReadDemo {',
    '  constructor(private readonly clock?: DemoClock) {}',
    '  execute(input: ReadDemoInput): ReadDemoOutput { return { id: input.id }; }',
    '}',
  ].join('\n'),
  [`${DEMO_QUERY}/read-demo.use-case.spec.ts`]: 'export {};',
  [DEMO_PUBLIC_ENTRY]: DEMO_PUBLIC_EXPORTS,
};

it('accepts a domain-free strict query whose public contracts and Nest wiring match', () => {
  expect(withProject(STRICT_SERVICE, 'service', [], 'strict')).toEqual([]);
});

it.each(['service', 'gateway'] as const)(
  'requires tests/ for cross-layer integration sources in the strict %s profile',
  (profile) => {
    const files = {
      ...STRICT_SERVICE,
      'tests/read-demo.int-spec.ts': 'export {};',
      'tests/support/demo-fixture.ts': 'export const id = "demo";',
    };
    expect(withProject(files, profile, [], 'strict')).toEqual([]);
    expect(
      withProject(
        {
          ...files,
          'test/read-demo.int-spec.ts': 'export {};',
          'tests/read-demo.spec.ts': 'export {};',
        },
        profile,
        [],
        'strict',
      ),
    ).toEqual([
      expect.objectContaining({
        file: 'test/read-demo.int-spec.ts',
        rule: 'strict-test-directory',
      }),
      expect.objectContaining({ file: 'tests/read-demo.spec.ts', rule: 'cross-layer-spec' }),
    ]);
  },
);

const READ_DEMO_CASE = `${DEMO_QUERY}/read-demo.use-case.ts`;
const READ_DEMO_INPUT = `${DEMO_QUERY}/read-demo.input.ts`;
const READ_DEMO_OUTPUT = `${DEMO_QUERY}/read-demo.output.ts`;
const DEMO_CLOCK_PORT =
  'src/modules/demo/application/ports/outbound/clock/lifecycle/demo-clock.port.ts';
const DEMO_DTO = 'src/modules/demo/presentation/http/dto/input/demo/read-demo-body.dto.ts';

it.each(['service', 'gateway'] as const)(
  'accepts role-specific exports and private declarations in a strict %s profile',
  (profile) => {
    expect(
      withProject(
        {
          ...STRICT_SERVICE,
          [READ_DEMO_INPUT]:
            'interface ReadDemoInput { readonly id: string; } export type { ReadDemoInput };',
          [DEMO_DTO]:
            'type RawId = string; export class ReadDemoBodyDto { readonly id: RawId = "demo"; }',
          'src/modules/demo/infrastructure/adapters/http/parse-retry-after.ts':
            'export const parseRetryAfter = (value: string) => Number(value);',
        },
        profile,
        [],
        'strict',
      ),
    ).toEqual([]);
  },
);

it('flags export names, grouped contracts and generic technical utility paths in strict mode', () => {
  const genericDirectory = 'src/config/utils/parse.ts';
  const genericFile = 'src/modules/demo/infrastructure/adapters/http/request-helpers.ts';
  const findings = withProject(
    {
      ...STRICT_SERVICE,
      [READ_DEMO_CASE]: 'export default class ReadDemo { execute(): void {} }',
      [READ_DEMO_INPUT]: 'interface ReadDemoInput {} export type { ReadDemoInput as WrongInput };',
      [READ_DEMO_OUTPUT]: 'export interface ReadDemoOutput {} export interface InternalDetail {}',
      [DEMO_CLOCK_PORT]: 'export interface WallClock {}',
      [DEMO_DTO]: 'export class ReadDemoBody {} export class ReadDemoHeaders {}',
      [genericDirectory]: 'export const parse = Number;',
      [genericFile]: 'export const parse = Number;',
    },
    'service',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: READ_DEMO_CASE, rule: 'strict-role-export' }),
      expect.objectContaining({ file: READ_DEMO_INPUT, rule: 'strict-role-export' }),
      expect.objectContaining({ file: READ_DEMO_OUTPUT, rule: 'strict-contract-file' }),
      expect.objectContaining({ file: DEMO_CLOCK_PORT, rule: 'strict-role-export' }),
      expect.objectContaining({ file: DEMO_DTO, rule: 'strict-contract-file' }),
      expect.objectContaining({ file: genericDirectory, rule: 'strict-utility-path' }),
      expect.objectContaining({ file: genericFile, rule: 'strict-utility-path' }),
    ]),
  );
});

it.each(['static', 'protected', 'private'] as const)(
  'rejects a %s execute method even on a correctly named use case',
  (modifier) => {
    const findings = withProject(
      {
        ...STRICT_SERVICE,
        [READ_DEMO_CASE]: `export class ReadDemo { ${modifier} execute(): void {} }`,
      },
      'service',
      [],
      'strict',
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ file: READ_DEMO_CASE, rule: 'strict-use-case-execute' }),
    );
  },
);

it('requires a runtime export of the use case class', () => {
  const findings = withProject(
    {
      ...STRICT_SERVICE,
      [READ_DEMO_CASE]: 'class ReadDemo { execute(): void {} } export type { ReadDemo };',
    },
    'service',
    [],
    'strict',
  );
  expect(findings).toContainEqual(
    expect.objectContaining({ file: READ_DEMO_CASE, rule: 'strict-role-export' }),
  );
});

it.each(['service', 'gateway'] as const)(
  'accepts inline Nest wiring without a composition directory for the strict %s profile',
  (profile) => {
    const files = Object.fromEntries(
      Object.entries(STRICT_SERVICE).filter(([file]) => !file.includes('/composition/')),
    );
    expect(
      withProject(
        {
          ...files,
          'src/modules/demo/demo.module.ts': [
            "import { Module } from '@nestjs/common';",
            "import type { DemoClock } from './application/ports/outbound/clock/lifecycle/demo-clock.port.js';",
            "import { SystemClock } from './infrastructure/adapters/clock/system-clock.adapter.js';",
            "import { DemoController } from './presentation/http/controllers/demo/demo.controller.js';",
            "import { ReadDemo } from './public/lifecycle/read-demo.js';",
            "const DEMO_CLOCK = Symbol('demo-clock');",
            '@Module({',
            '  controllers: [DemoController],',
            '  providers: [',
            '    { provide: DEMO_CLOCK, useFactory: () => new SystemClock() },',
            '    { provide: ReadDemo, inject: [DEMO_CLOCK], useFactory: (clock: DemoClock) => new ReadDemo(clock) },',
            '  ],',
            '  exports: [ReadDemo],',
            '})',
            'export class DemoModule {}',
          ].join('\n'),
          'src/modules/demo/infrastructure/adapters/clock/system-clock.adapter.ts': [
            "import type { DemoClock } from '../../../application/ports/outbound/clock/lifecycle/demo-clock.port.js';",
            'export class SystemClock implements DemoClock { now(): Date { return new Date(0); } }',
          ].join('\n'),
        },
        profile,
        [],
        'strict',
      ),
    ).toEqual([]);
  },
);

it('reports a repository re-export and a private type nested in a public result', () => {
  const privateModel: string =
    'src/modules/demo/application/models/lifecycle/audit-detail.model.ts';
  const repository: string =
    'src/modules/demo/infrastructure/persistence/drizzle/repositories/lifecycle/demo.repository.ts';
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_SERVICE,
      [privateModel]: 'export interface AuditDetail { readonly internalId: string; }',
      [repository]: 'export class DemoRepository {}',
      [`${DEMO_QUERY}/read-demo.output.ts`]: [
        "import type { AuditDetail } from '../../../../models/lifecycle/audit-detail.model.js';",
        'export interface ReadDemoOutput { readonly id: string; readonly detail?: ReadonlyArray<{ readonly value: AuditDetail }>; }',
      ].join('\n'),
      [DEMO_PUBLIC_ENTRY]:
        DEMO_PUBLIC_EXPORTS +
        "\nexport { DemoRepository as PublishedReader } from '../../infrastructure/persistence/drizzle/repositories/lifecycle/demo.repository.js';",
    },
    'service',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: DEMO_PUBLIC_ENTRY, rule: 'strict-public-export' }),
      expect.objectContaining({
        rule: 'strict-public-type',
        message: expect.stringContaining('AuditDetail'),
      }),
    ]),
  );
});

it('requires the owner to export the public Nest provider and declare its consumers', () => {
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_SERVICE,
      'src/modules/demo/MODULE.md':
        MODULE_DOC + '| demo.module | reports |\n| public/lifecycle/read-demo | missing-module |\n',
      'src/modules/demo/demo.module.ts': [
        "import { Module } from '@nestjs/common';",
        "import { ReadDemo } from './public/lifecycle/read-demo.js';",
        "import { DemoController } from './presentation/http/controllers/demo/demo.controller.js';",
        '@Module({ controllers: [DemoController], providers: [ReadDemo] })',
        'export class DemoModule {}',
      ].join('\n'),
    },
    'service',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: 'src/modules/demo/MODULE.md', rule: 'strict-public-entry' }),
      expect.objectContaining({ rule: 'strict-public-nest-export' }),
      expect.objectContaining({
        file: 'src/modules/reports/infrastructure/adapters/demo/demo.adapter.ts',
        rule: 'intermodule-private',
      }),
    ]),
  );
});

it('rejects flat operations, grouped port contracts and eager cycles in strict services', () => {
  const root: string = 'src/modules/demo/application';
  const groupedPorts: string = `${root}/ports/outbound/persistence/lifecycle/demo.port.ts`;
  const flatCase: string = `${root}/use-cases/commands/rename-demo.use-case.ts`;
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_SERVICE,
      [groupedPorts]: 'export interface DemoReader {}\nexport type DemoWriter = () => void;',
      [flatCase]: 'export class RenameDemo { execute(): void {} }',
      [`${root}/models/lifecycle/first.model.ts`]:
        "import './second.model.js'; export const first = 1;",
      [`${root}/models/lifecycle/second.model.ts`]:
        "import './first.model.js'; export const second = 2;",
    },
    'service',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: groupedPorts, rule: 'strict-contract-file' }),
      expect.objectContaining({ file: flatCase, rule: 'strict-layout' }),
      expect.objectContaining({ rule: 'execution-cycle' }),
    ]),
  );
});

it('keeps provider SDKs at the service boundary and rejects SQL in the gateway', () => {
  const useCase: string =
    'src/modules/demo/application/use-cases/commands/lifecycle/start-checkout/start-checkout.use-case.ts';
  const stripeAdapter: string =
    'src/modules/demo/infrastructure/adapters/stripe/stripe-checkout.adapter.ts';
  const serviceFindings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_SERVICE,
      [useCase]:
        "import type Stripe from 'stripe'; export class StartCheckout { execute(): Stripe | undefined { return undefined; } }",
      [stripeAdapter]:
        "import Stripe from 'stripe'; export class StripeCheckoutAdapter { constructor(private readonly stripe: Stripe) {} }",
    },
    'service',
    [],
    'strict',
  );
  expect(serviceFindings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: useCase, rule: 'framework-free' }),
      expect.objectContaining({ file: useCase, rule: 'adapter-boundary' }),
    ]),
  );
  expect(serviceFindings.some(({ file }) => file === stripeAdapter)).toBe(false);

  const gatewayFindings: readonly ArchitectureFinding[] = withProject(
    {
      'src/modules/presence/MODULE.md': MODULE_DOC,
      'src/modules/presence/presence.module.ts':
        'import { Module } from "@nestjs/common"; @Module({}) export class PresenceModule {}',
      'src/modules/presence/infrastructure/adapters/pg/presence.adapter.ts':
        "import type { Pool } from 'pg'; export class PresenceAdapter { constructor(private readonly db: Pool) {} }",
    },
    'gateway',
    [],
    'strict',
  );
  expect(gatewayFindings).toEqual([expect.objectContaining({ rule: 'adapter-boundary' })]);
});

it('allows kit modules in technical bootstrap without allowing direct SDKs there', () => {
  const module = 'src/app.module.ts';
  const bootstrap = 'src/realtime-application.ts';

  expect(
    withProject(
      {
        [module]: [
          "import { DatabaseModule } from '@cadenway/nest-common/database';",
          "import { OutboxModule } from '@cadenway/nest-messaging/outbox';",
          "import Stripe from 'stripe';",
          'export const deps = [DatabaseModule, OutboxModule, Stripe];',
        ].join('\n'),
        'src/config/app-config.ts':
          "import { databaseConfigShape } from '@cadenway/nest-common/database'; export const shape = databaseConfigShape;",
      },
      'service',
      [],
      'strict',
    ),
  ).toEqual([expect.objectContaining({ file: module, line: 3, rule: 'adapter-boundary' })]);

  expect(
    withProject(
      {
        [bootstrap]:
          "import { ResilientRedisClient } from '@cadenway/nest-common/redis'; export const redis = ResilientRedisClient;",
      },
      'gateway',
      [],
      'strict',
    ),
  ).toEqual([]);
});

const ME_ROOT: string = 'src/modules/me';
const ME_MODULE: string = ME_ROOT + '/me.module.ts';
const MIRROR_CONTROLLER: string = ME_ROOT + '/presentation/http/controllers/users/me.controller.ts';
const MIRROR_PORT: string =
  ME_ROOT + '/application/ports/outbound/identity/users/identity-users.port.ts';
const MIRROR_TOKEN: string = ME_ROOT + '/composition/tokens/users/identity-users.token.ts';
const ME_USE_CASE: string =
  ME_ROOT + '/application/use-cases/queries/users/get-me/get-me.use-case.ts';
const TASK_DETAIL: string = 'src/modules/task-detail';

const STRICT_HTTP_GATEWAY: Readonly<Record<string, string>> = {
  'tsconfig.base.json':
    '{"compilerOptions":{"module":"nodenext","experimentalDecorators":true,"paths":{"@clients/*":["./src/clients/*"],"@me/*":["./src/modules/me/*"]}}}',
  'src/app.module.ts': [
    "import { Module } from '@nestjs/common';",
    "import { ClientsModule } from './clients/clients.module.js';",
    "import { MeModule } from './modules/me/me.module.js';",
    "import { TaskDetailModule } from './modules/task-detail/task-detail.module.js';",
    '@Module({ imports: [ClientsModule, MeModule, TaskDetailModule] }) export class AppModule {}',
  ].join('\n'),
  'src/clients/generated/identity-service.ts': 'export const getUser = () => ({ id: "demo" });',
  'src/clients/generated/helpers/transport.dto.ts':
    'export interface Body {} export interface Headers {}',
  'src/presentation/http/mappers/current-user.mapper.ts':
    'export const toCurrentUser = (user: { id: string }) => ({ id: user.id });',
  'src/clients/identity-service.client.ts': [
    "import { getUser } from './generated/identity-service.js';",
    'export class IdentityServiceClient { readUser() { return getUser(); } }',
  ].join('\n'),
  'src/clients/clients.module.ts': [
    "import { Module } from '@nestjs/common';",
    "import { IdentityServiceClient } from './identity-service.client.js';",
    '@Module({ providers: [IdentityServiceClient], exports: [IdentityServiceClient] })',
    'export class ClientsModule {}',
  ].join('\n'),
  [ME_ROOT + '/MODULE.md']: MODULE_DOC,
  [MIRROR_PORT]: 'export interface IdentityUsers { readUser(): { readonly id: string }; }',
  [MIRROR_TOKEN]: 'export const IDENTITY_USERS = Symbol("identity-users");',
  [ME_USE_CASE]: [
    "import type { IdentityUsers } from '../../../../ports/outbound/identity/users/identity-users.port.js';",
    'export class GetMe {',
    '  constructor(private readonly users: IdentityUsers) {}',
    '  execute() { return this.users.readUser(); }',
    '}',
  ].join('\n'),
  [MIRROR_CONTROLLER]: [
    "import { Controller, Get } from '@nestjs/common';",
    "import { toCurrentUser } from '../../../../../../presentation/http/mappers/current-user.mapper.js';",
    "import { GetMe as ReadCurrentUser } from '@me/application/use-cases/queries/users/get-me/get-me.use-case.js';",
    '@Controller("me") export class MeController {',
    '  constructor(private readonly getMe: ReadCurrentUser) {}',
    '  @Get() read() { return this.loadCurrentUser(); }',
    '  private loadCurrentUser() { return toCurrentUser(this.getMe.execute()); }',
    '}',
  ].join('\n'),
  [ME_ROOT + '/infrastructure/adapters/identity/identity-users.adapter.ts']: [
    "import type { IdentityServiceClient } from '@clients/identity-service.client.js';",
    "import type { IdentityUsers } from '../../../application/ports/outbound/identity/users/identity-users.port.js';",
    'export class IdentityUsersAdapter implements IdentityUsers {',
    '  constructor(private readonly client: IdentityServiceClient) {}',
    '  readUser() { return this.client.readUser(); }',
    '}',
  ].join('\n'),
  [ME_ROOT + '/composition/providers/adapters/users/identity-users.provider.ts']: [
    "import { IdentityServiceClient } from '@clients/identity-service.client.js';",
    "import { IdentityUsersAdapter } from '../../../../infrastructure/adapters/identity/identity-users.adapter.js';",
    "import { IDENTITY_USERS } from '../../../tokens/users/identity-users.token.js';",
    'export const identityUsersProvider = {',
    '  provide: IDENTITY_USERS,',
    '  inject: [IdentityServiceClient],',
    '  useFactory: (client: IdentityServiceClient) => new IdentityUsersAdapter(client),',
    '};',
  ].join('\n'),
  [ME_ROOT + '/composition/providers/use-cases/users/get-me.provider.ts']: [
    "import type { IdentityUsers } from '../../../../application/ports/outbound/identity/users/identity-users.port.js';",
    "import { GetMe } from '../../../../application/use-cases/queries/users/get-me/get-me.use-case.js';",
    "import { IDENTITY_USERS } from '../../../tokens/users/identity-users.token.js';",
    'export const getMeProvider = {',
    '  provide: GetMe,',
    '  inject: [IDENTITY_USERS],',
    '  useFactory: (users: IdentityUsers) => new GetMe(users),',
    '};',
  ].join('\n'),
  [ME_MODULE]: [
    "import { Module } from '@nestjs/common';",
    "import { ClientsModule } from '../../clients/clients.module.js';",
    "import { identityUsersProvider } from './composition/providers/adapters/users/identity-users.provider.js';",
    "import { getMeProvider } from './composition/providers/use-cases/users/get-me.provider.js';",
    "import { MeController } from './presentation/http/controllers/users/me.controller.js';",
    '@Module({ imports: [ClientsModule], controllers: [MeController], providers: [identityUsersProvider, getMeProvider] })',
    'export class MeModule {}',
  ].join('\n'),
  [TASK_DETAIL + '/MODULE.md']: MODULE_DOC,
  [TASK_DETAIL + '/application/ports/outbound/tasks/detail/tasks.port.ts']:
    'export interface Tasks { findTask(): string; }',
  [TASK_DETAIL + '/application/ports/outbound/comments/detail/comments.port.ts']:
    'export interface Comments { findComments(): string[]; }',
  [TASK_DETAIL +
  '/application/use-cases/queries/lifecycle/get-task-detail/get-task-detail.use-case.ts']: [
    "import type { Tasks } from '../../../../ports/outbound/tasks/detail/tasks.port.js';",
    "import type { Comments } from '../../../../ports/outbound/comments/detail/comments.port.js';",
    'export class GetTaskDetail {',
    '  constructor(private readonly tasks: Tasks, private readonly comments: Comments) {}',
    '  execute() { return { task: this.tasks.findTask(), comments: this.comments.findComments() }; }',
    '}',
  ].join('\n'),
  [TASK_DETAIL + '/presentation/http/controllers/tasks/task-detail.controller.ts']: [
    "import { Controller, Get } from '@nestjs/common';",
    "import { GetTaskDetail } from '../../../../application/use-cases/queries/lifecycle/get-task-detail/get-task-detail.use-case.js';",
    '@Controller("tasks") export class TaskDetailController {',
    '  constructor(private readonly detail: GetTaskDetail) {}',
    '  @Get() read() { return this.detail.execute(); }',
    '}',
  ].join('\n'),
  [TASK_DETAIL + '/composition/providers/use-cases/lifecycle/get-task-detail.provider.ts']: [
    "import { GetTaskDetail } from '../../../../application/use-cases/queries/lifecycle/get-task-detail/get-task-detail.use-case.js';",
    'export const taskDetailProvider = {',
    '  provide: GetTaskDetail,',
    '  useFactory: () => new GetTaskDetail({ findTask: () => "demo" }, { findComments: () => [] }),',
    '};',
  ].join('\n'),
  [TASK_DETAIL + '/task-detail.module.ts']: [
    "import { Module } from '@nestjs/common';",
    "import { taskDetailProvider } from './composition/providers/use-cases/lifecycle/get-task-detail.provider.js';",
    "import { TaskDetailController } from './presentation/http/controllers/tasks/task-detail.controller.js';",
    '@Module({ controllers: [TaskDetailController], providers: [taskDetailProvider] })',
    'export class TaskDetailModule {}',
  ].join('\n'),
};

it('accepts one-to-one and aggregate gateway modules with local use cases and shared clients', () => {
  expect(withProject(STRICT_HTTP_GATEWAY, 'gateway', [], 'strict')).toEqual([]);
});

it('lets only declared gateway consumers use an exported guard through its public entry', () => {
  const guardEntry: string = '../../../../../auth/public/session/session-guard.js';
  const routeController: string = [
    "import { SessionGuard } from '" + guardEntry + "';",
    STRICT_HTTP_GATEWAY[MIRROR_CONTROLLER]?.replace(
      'Controller, Get',
      'Controller, Get, UseGuards',
    ).replace('@Controller("me")', '@Controller("me") @UseGuards(SessionGuard)'),
  ].join('\n');
  const sources: Readonly<Record<string, string>> = {
    ...STRICT_HTTP_GATEWAY,
    'src/modules/auth/MODULE.md':
      MODULE_DOC + '| auth.module | me |\n| public/session/session-guard | me |\n',
    'src/modules/auth/presentation/http/guards/session/session.guard.ts': [
      "import { Injectable } from '@nestjs/common';",
      '@Injectable() export class SessionGuard { canActivate(): boolean { return true; } }',
    ].join('\n'),
    'src/modules/auth/public/session/session-guard.ts':
      "export { SessionGuard } from '../../presentation/http/guards/session/session.guard.js';",
    'src/modules/auth/auth.module.ts': [
      "import { Module } from '@nestjs/common';",
      "import { SessionGuard } from './public/session/session-guard.js';",
      '@Module({ providers: [SessionGuard], exports: [SessionGuard] }) export class AuthModule {}',
    ].join('\n'),
    [MIRROR_CONTROLLER]: routeController,
    [ME_MODULE]: [
      "import { AuthModule } from '../auth/auth.module.js';",
      STRICT_HTTP_GATEWAY[ME_MODULE]?.replace(
        'imports: [ClientsModule]',
        'imports: [ClientsModule, AuthModule]',
      ),
    ].join('\n'),
  };

  expect(withProject(sources, 'gateway', [], 'strict')).toEqual([]);
  expect(
    withProject(
      {
        ...sources,
        'src/modules/auth/MODULE.md':
          MODULE_DOC + '| auth.module | me |\n| public/session/session-guard | task-detail |\n',
      },
      'gateway',
      [],
      'strict',
    ),
  ).toEqual([expect.objectContaining({ file: MIRROR_CONTROLLER, rule: 'intermodule-private' })]);
  expect(
    withProject(
      {
        ...sources,
        [MIRROR_CONTROLLER]: routeController.replace(
          guardEntry,
          '../../../../../auth/presentation/http/guards/session/session.guard.js',
        ),
      },
      'gateway',
      [],
      'strict',
    ),
  ).toEqual([expect.objectContaining({ file: MIRROR_CONTROLLER, rule: 'intermodule-private' })]);
});

it('rejects inverted client wiring and direct generated-client access even via aliases', () => {
  const clientModule: string = 'src/clients/clients.module.ts';
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_HTTP_GATEWAY,
      [clientModule]:
        STRICT_HTTP_GATEWAY[clientModule] +
        "\nexport { IDENTITY_USERS } from '@me/composition/tokens/users/identity-users.token.js';",
      [MIRROR_CONTROLLER]:
        STRICT_HTTP_GATEWAY[MIRROR_CONTROLLER] +
        "\nexport { getUser } from '@clients/generated/identity-service.js';",
    },
    'gateway',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: clientModule, rule: 'module-private' }),
      expect.objectContaining({ file: MIRROR_CONTROLLER, rule: 'adapter-boundary' }),
    ]),
  );
});

it('rejects direct ports and tokens in a gateway HTTP controller', () => {
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_HTTP_GATEWAY,
      [MIRROR_CONTROLLER]: [
        "import { Controller, Get, Inject } from '@nestjs/common';",
        "import type { IdentityUsers } from '@me/application/ports/outbound/identity/users/identity-users.port.js';",
        "import { IDENTITY_USERS } from '@me/composition/tokens/users/identity-users.token.js';",
        '@Controller("me") export class MeController {',
        '  constructor(@Inject(IDENTITY_USERS) private readonly users: IdentityUsers) {}',
        '  @Get() read() { return this.users.readUser(); }',
        '}',
      ].join('\n'),
    },
    'gateway',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: MIRROR_CONTROLLER, line: 2, rule: 'layer-direction' }),
      expect.objectContaining({ file: MIRROR_CONTROLLER, line: 3, rule: 'layer-direction' }),
      expect.objectContaining({ file: MIRROR_CONTROLLER, rule: 'strict-http-use-case' }),
    ]),
  );
});

it('requires each Nest HTTP route to delegate to a local use case', () => {
  const original: string =
    "import { QueryMethod as HttpQuery } from '@nestjs/common';\n" +
    (STRICT_HTTP_GATEWAY[MIRROR_CONTROLLER] ?? '');
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_HTTP_GATEWAY,
      [MIRROR_CONTROLLER]:
        original.slice(0, original.lastIndexOf('}')) +
        '  @Get("status") status() { return { status: "ok" }; }\n' +
        '  @HttpQuery("search") search() { return []; }\n}',
    },
    'gateway',
    [],
    'strict',
  );
  expect(findings).toEqual([
    expect.objectContaining({ file: MIRROR_CONTROLLER, rule: 'strict-http-use-case' }),
    expect.objectContaining({ file: MIRROR_CONTROLLER, rule: 'strict-http-use-case' }),
  ]);
});

it('does not accept a foreign use case referenced through an alias as HTTP delegation', () => {
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_HTTP_GATEWAY,
      [MIRROR_CONTROLLER]: (STRICT_HTTP_GATEWAY[MIRROR_CONTROLLER] ?? '').replace(
        "import { GetMe as ReadCurrentUser } from '@me/application/use-cases/queries/users/get-me/get-me.use-case.js';",
        "import { GetTaskDetail as ReadCurrentUser } from '../../../../../task-detail/application/use-cases/queries/lifecycle/get-task-detail/get-task-detail.use-case.js';",
      ),
    },
    'gateway',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: MIRROR_CONTROLLER, rule: 'intermodule-private' }),
      expect.objectContaining({ file: MIRROR_CONTROLLER, rule: 'strict-http-use-case' }),
    ]),
  );
});

it('rejects the former root and nested owners only in strict gateway mode', () => {
  const legacyPaths: readonly string[] = [
    'src/connection/presentation/websocket/connection.ts',
    'src/routes/auth/presentation/http/auth.ts',
    'src/aggregates/tasks/application/task.ts',
    'src/public/contact/presentation/http/contact.ts',
    'src/relays/task-events/presentation/messaging/relay.ts',
  ];
  const sources: Readonly<Record<string, string>> = Object.fromEntries(
    legacyPaths.map((file) => [file, 'export {};']),
  );
  expect(withProject(sources, 'gateway')).toEqual([]);
  expect(withProject(sources, 'gateway', [], 'strict')).toEqual(
    expect.arrayContaining(
      legacyPaths.map((file) => expect.objectContaining({ file, rule: 'strict-ownership' })),
    ),
  );
});

it('finds unknown layers, keeps Auth private from AuthRoutes and rejects a gateway domain', () => {
  const unknownLayers: readonly string[] = [
    ME_ROOT + '/presenation/route.ts',
    'src/modules/presence/domain/aggregates/presence/presence.aggregate.ts',
  ];
  const importingOwner: string =
    'src/modules/auth-routes/application/models/session/session.model.ts';
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      ...STRICT_HTTP_GATEWAY,
      ...Object.fromEntries(unknownLayers.map((file) => [file, 'export {};'])),
      'src/utils/unowned.ts': 'export const unowned = 1;',
      'src/modules/auth/application/models/session/private-session.model.ts':
        'export interface PrivateSession { readonly id: string; }',
      [importingOwner]: [
        "import type { PrivateSession } from '../../../../auth/application/models/session/private-session.model.js';",
        'export type Session = PrivateSession;',
      ].join('\n'),
    },
    'gateway',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      ...unknownLayers.map((file) => expect.objectContaining({ file, rule: 'strict-layer' })),
      expect.objectContaining({ file: 'src/utils/unowned.ts', rule: 'strict-ownership' }),
      expect.objectContaining({ file: importingOwner, rule: 'intermodule-private' }),
    ]),
  );
});

it('requires a manifest and root Nest wiring even for an adapter-only gateway module', () => {
  const findings: readonly ArchitectureFinding[] = withProject(
    {
      'src/modules/presence/infrastructure/adapters/redis/redis-presence.adapter.ts':
        'export class RedisPresenceAdapter {}',
    },
    'gateway',
    [],
    'strict',
  );

  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: 'module-contract' }),
      expect.objectContaining({
        file: 'src/modules/presence/presence.module.ts',
        rule: 'module-wiring',
      }),
    ]),
  );
});

it('accepts realtime modules and a shared redis adapter without a business domain', () => {
  const sources: Readonly<Record<string, string>> = {
    'src/realtime-application.ts': "import './infrastructure/redis/redis-io.adapter.js';",
    'src/infrastructure/redis/redis-io.adapter.ts': [
      "import type { ResilientRedisClient } from '@cadenway/nest-common/redis';",
      'export class RedisIoAdapter { constructor(private readonly redis: ResilientRedisClient) {} }',
    ].join('\n'),
    'src/modules/connection/MODULE.md': MODULE_DOC,
    'src/modules/connection/presentation/websocket/gateways/tasks/task-room.gateway.ts': [
      "import { WebSocketGateway } from '@nestjs/websockets';",
      '@WebSocketGateway() export class TaskRoomGateway {}',
    ].join('\n'),
    'src/modules/connection/connection.module.ts': [
      "import { Module } from '@nestjs/common';",
      "import { TaskRoomGateway } from './presentation/websocket/gateways/tasks/task-room.gateway.js';",
      '@Module({ providers: [TaskRoomGateway] }) export class ConnectionModule {}',
    ].join('\n'),
    'src/modules/tasks-relay/MODULE.md': MODULE_DOC,
    'src/modules/tasks-relay/presentation/messaging/handlers/tasks/task-changed.handler.ts': [
      "import { Injectable } from '@nestjs/common';",
      "import { EventConsumers } from '@cadenway/nest-messaging';",
      '@Injectable() export class TaskChangedHandler {',
      '  constructor(private readonly consumers: EventConsumers) {}',
      '}',
    ].join('\n'),
    'src/modules/tasks-relay/tasks-relay.module.ts': [
      "import { Module } from '@nestjs/common';",
      "import { TaskChangedHandler } from './presentation/messaging/handlers/tasks/task-changed.handler.js';",
      '@Module({ providers: [TaskChangedHandler] }) export class TasksRelayModule {}',
    ].join('\n'),
    'src/modules/presence/MODULE.md': MODULE_DOC,
    'src/modules/presence/presence.module.ts':
      'import { Module } from "@nestjs/common"; @Module({}) export class PresenceModule {}',
    'src/modules/presence/infrastructure/adapters/redis/redis-presence.adapter.ts': [
      "import type { ResilientRedisClient } from '@cadenway/nest-common/redis';",
      'export class RedisPresenceAdapter { constructor(private readonly redis: ResilientRedisClient) {} }',
    ].join('\n'),
  };

  expect(withProject(sources, 'gateway', [], 'strict')).toEqual([]);
});

it('requires presentation rather than legacy api only when strict is selected', () => {
  const legacy: string = 'src/modules/demo/api/http/demo.controller.ts';
  const sources: Readonly<Record<string, string>> = {
    'src/modules/demo/MODULE.md': MODULE_DOC,
    'src/modules/demo/demo.module.ts': 'export class DemoModule {}',
    [legacy]:
      'import { Controller } from "@nestjs/common"; @Controller("demo") export class DemoController {}',
  };

  expect(withProject(sources)).toEqual([]);
  expect(withProject(sources, 'service', [], 'strict')).toEqual([
    expect.objectContaining({ file: legacy, rule: 'strict-layer' }),
  ]);
  expect(() =>
    withProject(
      sources,
      'service',
      [{ file: legacy, rule: 'strict-layer', reason: 'Legacy' }],
      'strict',
    ),
  ).toThrow(/strict/i);
});
