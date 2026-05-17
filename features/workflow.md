# Product Workflow

Ruflo is easiest to understand as a repeatable workflow, not as a static landing page.

## End-To-End Flow

1. Define a bounded goal and the repository or workspace scope.
2. Choose the agent roles, MCP tools, memory expectations, and human review checkpoints.
3. Run a small pilot before connecting sensitive repositories or long-running workflows.
4. Review the outputs, adjust prompts and permissions, then expand the workflow.

## First Useful Output

The first useful output should prove that Ruflo understands the user's operational context without requiring a risky full rollout.

Examples:

- Claude Code plugin evaluation: turn the concept into a concrete decision or artifact.
- CLI and MCP workflow setup: turn the concept into a concrete decision or artifact.
- Agent roles and swarms: turn the concept into a concrete decision or artifact.
- Memory and RAG expectations: turn the concept into a concrete decision or artifact.
- Hosted versus self-hosted evaluation: turn the concept into a concrete decision or artifact.

## Where The SaaS Fits

The SaaS should be linked from evaluation, feature, comparison, and checkout contexts with UTM:

- Main entry: https://ruflo.online/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=workflow_main_entry
- Pricing entry: https://ruflo.online/plans/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=workflow_pricing_entry
- Checkout entry: https://ruflo.online/checkout/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=workflow_checkout_entry

## Human Review Points

- Do not start with a private production repository.
- Keep credentials out of prompts and logs.
- Review MCP server permissions before use.
- Treat agent output as proposed work until a human verifies it.
