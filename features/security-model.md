# Security Model

This documentation is public. It should explain safe evaluation without leaking implementation details.

## Public-Safe Claims

- Ruflo is a hosted SaaS for agent orchestration.
- The documentation is independent from private production infrastructure.
- Readers should verify live behavior before making procurement or rollout decisions.
- Sensitive data should stay out of public examples and public GitHub issues.

## Practical Guardrails

- Do not start with a private production repository.
- Keep credentials out of prompts and logs.
- Review MCP server permissions before use.
- Treat agent output as proposed work until a human verifies it.

## Data Boundaries

Do not include:

- API keys, tokens, payment secrets, webhook secrets, or account identifiers.
- Private repositories, private customer names, private analytics, or local machine paths.
- Internal Cloudflare, database, registrar, or payment-provider configuration.
- Screenshots that reveal private sessions, accounts, or browser profiles.

## Safe Link

Use the public SaaS link with UTM:

- https://ruflo.online/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=security_safe_link
