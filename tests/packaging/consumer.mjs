import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , packageName, verifier, profile] = process.argv;
const specifier = `${packageName}/architecture`;
const { [verifier]: verify, ...unexpectedExports } = await import(specifier);
assert.equal(typeof verify, 'function');
assert.deepEqual(Object.keys(unexpectedExports), []);

const isNest = verifier === 'verifyNestArchitecture';
if (isNest) {
  const { fixtureId, fixtures, ...unexpectedRootExports } = await import(packageName);
  assert.equal(typeof fixtureId, 'function');
  assert.ok(fixtures.sprint14().task('CAD-482'));
  assert.deepEqual(Object.keys(unexpectedRootExports), []);
} else {
  await assert.rejects(import(packageName), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
}
await assert.rejects(import(`${packageName}/dist/architecture.js`), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
});

const rootDir = resolve('fixture');
const source = join(rootDir, 'src', isNest ? 'main.ts' : 'example.ts');
mkdirSync(join(rootDir, 'src'), { recursive: true });
writeFileSync(join(rootDir, 'package.json'), '{"type":"module"}\n');
writeFileSync(
  join(rootDir, 'tsconfig.json'),
  '{"compilerOptions":{"module":"NodeNext","types":[]},"include":["src"]}\n',
);
const options = { rootDir, tsconfig: 'tsconfig.json', profile };
writeFileSync(source, 'export const answer = 42;\n');
assert.deepEqual(verify(options), []);
writeFileSync(source, "import './unavailable.js';\n");
assert.ok(verify(options).some(({ rule }) => rule === 'unresolved-import'));
