# Stride

Personal productivity workspace built with React, TypeScript, vinext/Sites, IndexedDB, D1, and R2. Stride combines tasks, projects, School planning, habits and an overall streak, focus, optional wellness tools, cross-feature Insights, alarms, pages, and databases. The current release is a private development preview. Production readiness has **not** been established.

## Development

Use Node 22.13+ and `npm ci`. Run `npm run dev` for local development, `npm run typecheck`, `npm run lint`, and `npm test` for validation. `npm run build` validates the current entry in `releases.json`, produces the Worker and client bundles, emits an uncached `version.json`, and creates a versioned offline asset inventory. `npm start` serves the production build locally.

The test suite includes isolated IndexedDB databases, simulated failures, a real local D1/R2 runtime, and mocked authentication responses. It never uses a production account or sends real push notifications. `npm run benchmark` is an isolated synthetic storage diagnostic, not browser or iPhone performance certification.

Start with an empty guest workspace. Starter tasks are explicitly optional. Guest data belongs to that device and is transferred to a signed-in account only through the backup import flow. Account and notification features expose their configuration/capability requirements in Settings.

- [Architecture and persistence](docs/architecture.md)
- [Deployment and account setup](docs/deployment.md)
- [Release acceptance and remaining work](docs/release.md)
- [Formula language](docs/formulas.md)

The lightweight native Apple Watch companion source lives in `apple/StrideWatch`. An online-only browser companion is also available at `/watch` through a revocable link created in Settings. Pairing and server-originated sync mutations are covered by the local D1 integration test. Xcode signing and native distribution remain future work; physical Watch Link acceptance remains required when the target device is available.
