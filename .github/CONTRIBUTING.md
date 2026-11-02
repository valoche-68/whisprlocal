# Contributing to WhisprLocal

Please open an issue describing the user-visible problem before undertaking a large change. Small focused pull requests are welcome. English and French documentation are maintained together.

Keep the existing upstream visual style. Reuse its components, spacing, colors, typography tokens and onboarding shell. Removing a service removes its screens and actions; it is not a reason to redesign the application.

This edition supports Linux x86_64, local models and explicitly configured self-hosted servers only. Do not introduce login, billing, telemetry, official service calls or third-party account integrations. Self-hosted authentication is independent of provider cloud keys.

Run `npm run typecheck`, `npm run build:renderer`, `node scripts/whisprlocal/checks.cjs` and `npm run test:local` with Node 24 and a matching better-sqlite3 binding. A packaged build must rebuild native dependencies for Electron. Changes involving speech, GPU memory or paste also require a real desktop check.

Never commit profiles, backups, private logs, tokens, model weights or credentials. Screenshots must use a disposable profile. Preserve upstream authorship and MIT notices. Models and dependencies retain their own licenses.

Upstream migrations must preserve local behavior. Conflict reports block publication until a human resolves the migration. Passing CI does not authorize automatic merging or publication.
