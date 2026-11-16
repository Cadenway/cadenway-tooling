// Entries used across kit releases, including the compatibility façades.
const PUBLIC_KIT_ENTRIES: ReadonlyMap<string, string | undefined> = new Map([
  ['@cadenway/nest-common', undefined],
  ['@cadenway/nest-common/database', undefined],
  ['@cadenway/nest-common/redis', undefined],
  ['@cadenway/nest-common/telemetry', undefined],
  ['@cadenway/nest-common/hook.mjs', undefined],
  ['@cadenway/nest-common/register', undefined],
  ['@cadenway/nest-messaging', undefined],
  ['@cadenway/nest-messaging/outbox', undefined],
  ['@cadenway/nest-messaging/outbox/writer', 'outbox/writer'],
  ['@cadenway/nest-messaging/outbox/relay', 'outbox/relay'],
  ['@cadenway/nest-messaging/outbox/schema', 'outbox/schema'],
  ['@cadenway/nest-jobs', undefined],
  ['@cadenway/nest-jobs/runtime', 'runtime'],
  ['@cadenway/nest-jobs/provisioning', 'provisioning'],
]);

export function kitExportNamespace(specifier: string): string | undefined {
  return PUBLIC_KIT_ENTRIES.get(specifier);
}

/** Checks both bare imports and references that resolve into a kit package. */
export function isPrivateKitImport(specifier: string, resolvedPackage: string): boolean {
  const importedPackage = specifier.split('/', 2).join('/');
  const resolvesToKit = PUBLIC_KIT_ENTRIES.has(resolvedPackage);
  return (
    (PUBLIC_KIT_ENTRIES.has(importedPackage) || resolvesToKit) &&
    (!PUBLIC_KIT_ENTRIES.has(specifier) || (resolvesToKit && importedPackage !== resolvedPackage))
  );
}
