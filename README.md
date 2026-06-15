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

## What Ruflo Actually Is

Ruflo helps teams coordinate AI agents around real software work: planning, implementation, review, memory, MCP tools, and repeatable operating loops.

Use Ruflo when you need:

- Claude Code and Codex-style planning loops
- MCP tool coordination
- Memory and reusable workflow context
- Agent roles, swarms, and task routing
- Hosted evaluation path through the SaaS

The main hosted entry points are:

| Destination | Tracked link |
| --- | --- |
| SaaS home | [ruflo.online](https://ruflo.online/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=readme_links_home) |
| Pricing | [pricing](https://ruflo.online/plans/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=readme_links_pricing) |
| Checkout | [checkout](https://ruflo.online/checkout/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=readme_links_checkout) |

## Related Public Projects

If your Ruflo evaluation needs scenario modeling rather than work orchestration, open MiroFish alongside this guide:

| Project | Tracked link | Why it helps |
| --- | --- | --- |
| MiroFish | [mirofish.work](https://mirofish.work/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=related_mirofish) | Useful when a coordinated agent workflow should produce or evaluate multi-agent scenario simulations and structured reports. |

## Default Evaluation Path

1. Define a bounded goal and the repository or workspace scope.
2. Choose the agent roles, MCP tools, memory expectations, and human review checkpoints.
3. Run a small pilot before connecting sensitive repositories or long-running workflows.
4. Review the outputs, adjust prompts and permissions, then expand the workflow.

## Minimum Safety Checklist

- Do not start with a private production repository.
- Keep credentials out of prompts and logs.
- Review MCP server permissions before use.
- Treat agent output as proposed work until a human verifies it.

## Suggested Reading Order

1. [Quickstart](guide/quickstart.md)
2. [Evaluation](guide/evaluation.md)
3. [Workflow](features/workflow.md)
4. [Use cases](features/use-cases.md)
5. [Security model](features/security-model.md)
6. [Checkout and pricing](guide/checkout-and-pricing.md)
7. [FAQ](reference/faq.md)

## Contributing

Corrections are welcome. Keep this project public-safe: cite public sources, avoid copying long passages from other projects, and never include credentials, customer data, private logs, internal machine paths, or untracked outbound links.
