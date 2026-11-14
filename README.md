# Cadenway tooling

Development packages for Cadenway's applications, libraries and services.

| Package                                                           | Consumers                                     |
| ----------------------------------------------------------------- | --------------------------------------------- |
| [`@cadenway/angular-testing`](packages/angular-testing/README.md) | Angular applications and libraries            |
| [`@cadenway/nest-testing`](packages/nest-testing/README.md)       | NestJS services, gateways and the service kit |

```sh
pnpm install --frozen-lockfile
pnpm quality
```

## Release and adoption

The package names and exports are unchanged. Changesets versions releases and the release workflow publishes to GitHub Packages.

1. Land the service-kit change that removes `nest-testing` from its workspace and release plan. The design-system adoption can follow the first Angular tooling release.
2. Grant this repository Actions write access to the existing `@cadenway/nest-testing` package and read access to `@cadenway/nest-messaging` for the frozen install. The `nest-testing` package manifest points to this repository. When updating the package's GitHub repository link, preserve the published versions and existing consumers' read access, including access inherited from the original repository.
3. Configure the Cadenway GitHub App access for this repository, including the `CADENWAY_DEPLOY_APP_CLIENT_ID` variable and the `CADENWAY_DEPLOY_APP_PRIVATE_KEY` secret in the protected `release` environment. Keep the release environment restricted to `main`.
4. After the Changesets release, grant consumer repositories Actions read access to `@cadenway/angular-testing`. Update each consumer's development dependency through pnpm and commit its generated lockfile. Run `pnpm install --frozen-lockfile` and `pnpm test:architecture`, then add the architecture check to its quality script and CI in the same change. Keep local exceptions beside each consumer's suite.

The Nest package's optional messaging peer resolves from the published service kit. Runtime packages and the [hexagonal architecture guide](https://github.com/Cadenway/cadenway-service-kit/blob/main/docs/hexagonal-architecture.md) remain owned by the service kit.
