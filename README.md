# Ruflo AI

Ruflo AI is a hosted SaaS layer for Ruflo-style multi-agent workspaces. It packages the public Ruflo value proposition into a customer-facing launch path with product-led UI, pricing, Creem checkout, Cloudflare Worker APIs, Cloudflare Pages Functions, D1-backed analytics/order state, route-specific SEO metadata, robots.txt, and sitemap.xml.

## What This Site Provides

- Hosted launch flow for Ruflo workspaces
- Default Growth yearly checkout with a 50% annual discount
- Creem hosted checkout with homepage return after successful payment
- Useful resource pages for Ruflo AI, GitHub evaluation, Reddit research, Codex, Claude Code, UI, legitimacy checks, and first-use guidance
- Worker deployment for API routing, SEO HTML rendering, static assets, robots.txt, and sitemap.xml
- Pages deployment with a catch-all Function so Pages can serve the same API and metadata behavior
- D1 migrations for orders, users, sessions, deployments, analytics, and console state

## Commands

```bash
npm install
npm run build
npm run build:worker
npm test
npm run cloudflare:d1:migrate
npm run cloudflare:worker:deploy
npm run cloudflare:pages:deploy
```

## Deployment

The production deployment source is `git@github.com:clauxel/my_ruflo.git`.

The GitHub Actions workflow in `.github/workflows/deploy-cloudflare-worker.yml` installs dependencies, runs tests, builds Worker assets, applies D1 migrations, and deploys the `my-ruflo` Cloudflare Worker with `--keep-vars` so Dashboard-managed variables are preserved.

Push-to-main deployment is guarded by the repository variable `ENABLE_CLOUDFLARE_DEPLOY=true`. Manual deployment is available through `workflow_dispatch`.

Required GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- or `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL`
- `CLOUDFLARE_ACCOUNT_ID`

Configure payment credentials as Cloudflare secrets. The Worker accepts `API_PROD_KEY`, `CREEM_API_KEY`, or `CREEM_KEY` for live Creem checkout.
