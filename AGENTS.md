# Cadenway tooling

This repository owns development-only architecture and test helpers. Keep the existing npm package names and public subpaths. Angular UI, icons, and tokens belong to the design system. Nest runtime packages belong to the service kit.

- Use pnpm and the committed lockfile. Use published packages for cross-repository dependencies.
- Keep architecture checks static and independent of browser, framework and container startup.
- Run `pnpm quality` and prepare a Changeset for changes to a published package.
- Releases run from CI. Never push to main, publish from an agent shell or edit the generated lockfile by hand.
