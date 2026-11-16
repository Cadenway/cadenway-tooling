---
'@cadenway/nest-testing': minor
---

Add an opt-in strict hexagonal architecture convention for NestJS services and gateways. Check
capability ownership, contract placement, dependency direction and the types and providers that
cross a module's public boundary. Existing profiles keep their behavior when strict mode is omitted.
Both strict profiles use `src/modules/<module>/` and require HTTP controllers to depend on a local
use case. The gateway profile retains its restrictions on business persistence.
