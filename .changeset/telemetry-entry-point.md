---
'@cadenway/nest-testing': patch
---

Accept `src/telemetry.ts` at the top of `src/` in the `service` profile of `@cadenway/nest-testing/architecture`, beside `src/main.ts` and `src/migrate.ts`: it is the entry point `@cadenway/nest-common` prescribes, preloaded with `node --import ./dist/telemetry.js`. The `gateway` profile already accepted it and still does; the profiles are otherwise unchanged.

A service that declared an exception for it (`{ file: 'src/telemetry.ts', rule: 'service-layout' }`) removes that exception when it upgrades: the verifier rejects it as stale.
