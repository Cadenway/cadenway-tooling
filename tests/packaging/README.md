# Packaging checks

Run `pnpm build` followed by `pnpm test:packaging` from the repository root. The check packs the
build outputs, so start from clean generated `dist/` directories after switching from a revision
that built different source files.

The versioned consumer fixtures pin the public inputs, outputs and import paths from
`@cadenway/angular-testing@0.1.0` and `@cadenway/nest-testing@0.3.0`. The harness installs the
archives into temporary consumers with required peers, compiles the fixtures, and runs each
verifier against a valid and an invalid source file without starting a framework or container.

CI exercises the current toolchain and Node 24.15.0 with TypeScript 6.0.2, the first stable
TypeScript version in the Angular verifier's declared range.
