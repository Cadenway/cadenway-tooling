---
'@cadenway/nest-testing': minor
---

Add the mockup fixtures to the root entry point: `fixtures.atelierNord()` (Atelier Nord with Camille Martin, Inès Robert, Hugo Dubois and Léa Petit), `fixtures.cooperativeLumen()` (a second organization for isolation tests), `fixtures.sprint14()` (the space Produit, Sprint 14, its statuses and its hand-written tasks, `CAD-482` among them), `fixtures.statuses()` and `fixtureId()`.

`@cadenway/contracts` becomes an optional peer (`>=0.2.0 <1.0.0`): the fixtures are typed by its shared enumerations. The optional `@cadenway/nest-messaging` peer now accepts every version below 1.0.0.
