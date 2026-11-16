---
'@cadenway/nest-testing': minor
---

Check that strict kit exports use the declared outbox and jobs namespaces and
enforce the isolation of those runtime components. In strict services and
gateways, require imports of Service Kit packages to use published entries.

Recognize the PostgreSQL event deduplication entry, require its public index as the export
target, and keep event delivery and outbox publication independent of the PostgreSQL adapter.
