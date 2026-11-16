---
'@cadenway/nest-testing': minor
---

Enforce filename-derived exports for authored use cases, application inputs and outputs, outbound
ports and DTOs in strict mode. Require a public instance `execute` method on use cases and reject
generic utility paths. Use `tests/` for cross-layer integration sources in strict mode. The legacy
convention also recognizes `tests/` and continues accepting `test/`.
