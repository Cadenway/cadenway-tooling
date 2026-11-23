---
'@cadenway/nest-testing': patch
---

Reject additional Nest module files that declare a global module, including a private module
imported by the exported module. Check that providers exported only through auxiliary wiring are
available to every consumer declared for the corresponding public operation.
