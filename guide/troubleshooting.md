# Troubleshooting

This page lists practical issues that can appear while evaluating or linking to Ruflo.

## The Link Was Published Without UTM

Replace it with a tracked link from [reference/links.md](../reference/links.md). For a homepage link, use:

- https://ruflo.online/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=troubleshooting_missing_utm

## The Buyer Cannot Find Pricing

Send the tracked pricing link:

- https://ruflo.online/plans/?utm_source=github&utm_medium=documentation&utm_campaign=ruflo_docs&utm_content=troubleshooting_pricing

Then check whether the platform stripped query parameters. Some directories remove UTM fields. If that happens, record the platform-specific rule before retrying.

## The Product Fit Is Unclear

Return to [features/use-cases.md](../features/use-cases.md). If none of those use cases fit, do not force the product into the comparison.

## The Workflow Seems Too Sensitive

Use the smallest safe input first. The public docs should never ask readers to paste secrets, private customer records, privileged code, or regulated data into a public demo.

## Payment Or Checkout Fails

Use the product support path from the SaaS page. Do not publish provider-side invoice URLs, internal error logs, secret names, or account details in this docs project.
