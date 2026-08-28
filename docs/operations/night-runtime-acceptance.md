# Night watch

- **Authority receipt**: create a versioned, expiring receipt naming the exact approved Agent, `test` domain, bounded cleanup/restart, publication scope, and unattended setting. It must never contain credentials.
- **Dry run**: `npm run night-watch`; validates the manifest and emits no live operations.
- **Live run**: invoke the runner only with the separate approved receipt, exact Agent, and registered CLI/browser/runtime adapters.
- **Resume**: revalidate service health, manifest version, Agent, and the last synthetic coordinate before resuming the checkpoint.
- **Rollback**: retain local redacted evidence and synthetic facts; restore the authorized service in the runner's `finally` path. Do not delete evidence or business facts.
