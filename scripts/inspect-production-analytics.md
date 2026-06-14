# Production Inspection Script

This script turns the GenericAgent runtime and analytics checks into one reusable read-only command.

Current script path: `scripts/inspect-production-analytics.mjs`

## What it checks

- SSH into the GenericAgent production host with a private key or password when using the default remote mode
- Detect the active `EnvironmentFile` from the `systemd` service in remote mode
- Check the `systemd` service state and public site health in remote mode
- Query Cloudflare D1 analytics data from the deployed Worker runtime
- Query PostgreSQL analytics data from the legacy GenericAgent runtime database when needed
- Summarize referrers, landing paths, page routes, CTA clicks, funnel movement, checkout failures, and deduplicated payments
- Summarize Nginx page/API/static/console proxy traffic from access logs in remote mode

## Commands

Run the default Cloudflare D1 text report:

```bash
npm run prod:inspect
```

The default D1 target comes from `wrangler.toml` and currently resolves to `genericagent` over `wrangler d1 execute --remote`.

Query a local or Neon PostgreSQL source explicitly:

```bash
npm run prod:inspect:postgres
```

Write a JSON report:

```bash
npm run prod:inspect -- --format json --output ./genericagent-production-analytics-report.json
```

Inspect a different service or SSH key:

```bash
npm run prod:inspect:remote -- --service multica.service --ssh-key-path ~/.ssh/multicaLaunch_prod_205_key
```

Skip health checks and query only analytics:

```bash
npm run prod:inspect
```

## Data Source

- The script loads `.env.production` by default.
- `npm run prod:inspect` defaults to the Cloudflare D1 database bound in `wrangler.toml`.
- `--cloudflare-d1` skips SSH and queries the remote D1 database through Wrangler.
- `--d1-database <name>` overrides the D1 database name when you need to inspect another Cloudflare database.
- `--local-db` skips SSH and uses the current process environment plus loaded env files, falling back to the non-secret `neon-cordovan-zebra` host/user/database defaults.
- SSH settings come from CLI flags first, then `DEPLOY_*`, `MULTICA_DEPLOY_*`, and `MULTICA_SERVER_*` variables.
- The remote env file defaults to `/data/multica/multica.env`, or the active `EnvironmentFile` detected from `multica.service`.
- PostgreSQL prefers GenericAgent-specific analytics settings first: `GENERICAGENT_ANALYTICS_DATABASE_URL` / `GENERICAGENT_ANALYTICS_POSTGRES_URL`, then `GENERICAGENT_ANALYTICS_DB_*` plus the local DPAPI password file, then generic `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_PRISMA_URL` fallbacks only when no GenericAgent-specific analytics config is present. Remote runtime inspection still falls back to `MULTICA_POSTGRES_*` when no GenericAgent analytics override is configured.
- The report is read-only. It does not modify the remote host or database.
