import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const cases = [
  {
    name: 'angular-testing',
    baseline: '0.1.0',
    entries: ['./architecture'],
    verifier: 'verifyAngularArchitecture',
    profile: 'library',
  },
  {
    name: 'nest-testing',
    baseline: '0.3.0',
    entries: ['.', './architecture', './infrastructure'],
    verifier: 'verifyNestArchitecture',
    profile: 'service',
  },
];

const nestFrameworkPeers = {
  '@nestjs/common': '12.4.2',
  '@nestjs/core': '12.4.2',
  'reflect-metadata': '0.2.2',
  rxjs: '7.8.2',
  vite: '8.3.7',
};

function runPnpm(args, cwd) {
  const runner = process.env.npm_execpath;
  assert.ok(runner, 'Run via pnpm test:packaging to use the workspace package manager.');
  const javascript = /\.[cm]?js$/u.test(runner);
  return execFileSync(
    javascript ? process.execPath : runner,
    javascript ? [runner, ...args] : args,
    {
      cwd,
      encoding: 'utf-8',
    },
  );
}

function requiredPeers(manifest) {
  return Object.fromEntries(
    Object.entries(manifest.peerDependencies ?? {}).filter(
      ([name]) => !manifest.peerDependenciesMeta?.[name]?.optional,
    ),
  );
}

function assertArchive(archive, manifest, scenario) {
  const files = execFileSync('tar', ['-tf', archive], { encoding: 'utf-8' }).trim().split(/\r?\n/u);
  const distribution = files.filter((file) => !file.endsWith('/'));
  assert.deepEqual(Object.keys(manifest.exports).sort(), [...scenario.entries].sort());
  for (const target of Object.values(manifest.exports)) {
    assert.ok(distribution.includes(`package/${target.types.slice(2)}`), target.types);
    assert.ok(distribution.includes(`package/${target.default.slice(2)}`), target.default);
  }
  for (const file of distribution) {
    assert.match(file, /^package\/(?:dist\/.+|package\.json|README\.md|CHANGELOG\.md|LICENSE)$/u);
    if (scenario.name === 'nest-testing' && file.startsWith('package/dist/fixtures/')) {
      assert.match(
        file,
        /^package\/dist\/fixtures\/(?:atelier-nord|fixture-id|fixtures|sprint-14)\.(?:js(?:\.map)?|d\.ts(?:\.map)?)$/u,
      );
    } else {
      assert.doesNotMatch(
        file,
        /(?:\/(?:tests?|testing|fixtures?)\/|\.(?:spec|test|int-spec|fixture|mock|harness)\.|\.tsbuildinfo$)/u,
      );
    }
    if (file.startsWith('package/dist/')) {
      assert.match(file, /\.(?:js(?:\.map)?|d\.ts(?:\.map)?)$/u);
    }
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const version of Object.values(manifest[field] ?? {})) {
      assert.doesNotMatch(version, /^(?:catalog|workspace|link|file):/u);
    }
  }
}

for (const scenario of cases) {
  test(`${scenario.name} archive preserves the ${scenario.baseline} consumer API`, () => {
    const temporaryRoot = realpathSync(tmpdir());
    const directory = mkdtempSync(join(temporaryRoot, 'cadenway-tooling-packaging-'));
    try {
      const checkout = fileURLToPath(new URL(`../../packages/${scenario.name}/`, import.meta.url));
      const archive = join(directory, 'candidate.tgz');
      runPnpm(['pack', '--out', archive], checkout);
      const manifest = JSON.parse(
        execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf-8' }),
      );
      assertArchive(archive, manifest, scenario);

      const packageName = `@cadenway/${scenario.name}`;
      assert.equal(manifest.name, packageName);
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
          name: 'architecture-consumer',
          private: true,
          type: 'module',
          dependencies: {
            ...(scenario.name === 'nest-testing' ? nestFrameworkPeers : {}),
            ...requiredPeers(manifest),
            [packageName]: './candidate.tgz',
            typescript: process.env.CADENWAY_PACKAGING_TYPESCRIPT || ts.version,
          },
        }),
      );
      writeFileSync(
        join(directory, 'pnpm-workspace.yaml'),
        'autoInstallPeers: false\nstrictPeerDependencies: true\nminimumReleaseAge: 0\ntrustPolicy: no-downgrade\n',
      );
      runPnpm(['install', '--ignore-scripts', '--prefer-offline'], directory);

      const baseline = new URL(
        `./baselines/${scenario.name}-${scenario.baseline}.mts`,
        import.meta.url,
      );
      copyFileSync(baseline, join(directory, 'consumer.mts'));
      copyFileSync(new URL('./consumer.mjs', import.meta.url), join(directory, 'consumer.mjs'));
      execFileSync(
        process.execPath,
        [
          'node_modules/typescript/bin/tsc',
          '--ignoreConfig',
          '--noEmit',
          '--strict',
          '--module',
          'NodeNext',
          'consumer.mts',
        ],
        { cwd: directory, encoding: 'utf-8' },
      );
      execFileSync(
        process.execPath,
        ['consumer.mjs', packageName, scenario.verifier, scenario.profile],
        { cwd: directory, encoding: 'utf-8' },
      );
    } finally {
      assert.equal(dirname(realpathSync(directory)), temporaryRoot);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
