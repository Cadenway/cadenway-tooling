---
'@cadenway/nest-testing': minor
---

Support additional Nest module wiring under `composition/modules/<name>.module.ts`. The file
exports one local, named, non-global Nest module and must list its authorized consumers in the
owning `MODULE.md`. Its provider exports and runtime dependencies are subject to the same public
contract and cycle checks as the main capability module.
