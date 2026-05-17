# Developer Architecture Notes

This page explains Ruflo from a developer and evaluator perspective. It does not document private production code.

## Mental Model

Ruflo helps teams coordinate AI agents around real software work: planning, implementation, review, memory, MCP tools, and repeatable operating loops.

Think of the product as four layers:

1. Public explanation layer: homepage, guides, pricing, checkout, and support entry points.
2. Workflow layer: the repeatable user path described in this documentation.
3. Evidence layer: the artifacts, reports, previews, or decisions that make the workflow useful.
4. Commercial layer: tracked SaaS links, pricing, checkout, and support.

## Public Surfaces To Reference

| Surface | Tracked link |
| --- | --- |
| Homepage | https://ruflo.online/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=architecture_home |
| Pricing | https://ruflo.online/plans/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=architecture_pricing |
| Checkout | https://ruflo.online/checkout/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=architecture_checkout |

## What To Keep Out

- Private source repository names and remotes.
- Runtime secrets or payment configuration.
- Cloudflare account, database, registrar, or analytics details.
- Local screenshots that reveal account state.
- Customer-specific onboarding notes.

## Update Checklist

1. Confirm the live domain resolves to the expected product.
2. Confirm the pricing and checkout paths still exist.
3. Re-run the UTM link check before publishing.
4. Update README and reference links together.
