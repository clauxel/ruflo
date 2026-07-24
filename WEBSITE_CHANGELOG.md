# Website Changelog

## 2026-07-25 CST - K3nova contextual homepage reference

- Added a natural homepage body reference to K3nova from the workspace-review context with source-specific UTM attribution for `ruflo.online`.
- Updated both the React homepage source and static fallback so crawlable and rendered surfaces stay aligned.
- Placement: below the first-screen product explanation and away from nav, footer, pricing, checkout, and primary CTA links.
- Verification: static placement validation confirmed the K3nova URL, `utm_source=ruflo.online`, `utm_medium=owned_resource`, `utm_campaign=k3nova_contextual_reference`, and `utm_content=home_body`; `node --check worker/index.js` and `git diff --check` passed.
- Build note: `npm run build` could not run in the current checkout before dependency install because local build dependencies were absent (`tsc: command not found`).
- Deployment/Git status: prepared for the 2026-07-25 K3nova contextual homepage reference release.

## 2026-07-08 22:00 CST - Top decile patrol SEO repair

- Change summary: Promoted `/pricing/` to a crawlable page, expanded visible homepage and pricing content, restored pricing checkout CTAs, and kept transactional routes out of sitemap coverage.
- Verification: local build/test/patrol checks were run for the affected surface before commit; production deployment and live verification are tracked in the release pass for this patrol batch.
- Deployment/Git status: pending commit, push, deploy, and live post-deploy verification at entry time.

## 2026-06-07 14:14:14 CST

- Change summary: Added meta keywords support and expanded Ruflo AI keyword resource coverage with useful pages for hosted multi-agent workspaces, multi-agent coding workflows, AI agent memory/RAG, Goal Planner UI, codebase planning/review, and team agent operations.
- Touched files: `src/app-types.ts`, `src/lib/seo.ts`, `src/content/site-content.tsx`, `worker/index.js`, `index.html`, `resources/index.html`, `public/resources/index.html`, `pricing/index.html`, `public/pricing/index.html`, `public/sitemap.xml`, `llms.txt`, `public/llms.txt`, `test/public-seo-assets.test.mjs`.
- Verification: `npm run build` passed; `node --test test/public-seo-assets.test.mjs` passed; `node --test test/cloudflare-worker.test.mjs` passed; `npm test` still has an existing unrelated failure in `test/analytics-flow.test.mjs` at the visitor analytics assertion `0 !== 1`.
- Deployment/Git status: Local code changes only at entry time; no commit, push, or production deploy performed yet.
- Follow-up items: Build output includes `meta name="keywords"` and sitemap lists 24 public URLs including every new resource page. Production deploy is still pending if Owner wants this live.

## 2026-06-07 14:37:37 CST

- Change summary: Published the Ruflo AI keyword/resource-page update to production Cloudflare Worker.
- Touched files: `WEBSITE_CHANGELOG.md`.
- Verification: GitHub push completed for commit `ee3cb1e`; Cloudflare Worker deploy completed as version `946c8e0f-3107-4888-b2b2-a4232f33150d`; public NS resolves to `archer.ns.cloudflare.com` and `sydney.ns.cloudflare.com`; `https://ruflo.online/` returns 200 with `meta name="keywords"` and no parking copy; `https://www.ruflo.online/` redirects 301 to apex; all six new resource pages return 200 with crawlable fallback and keywords; `/sitemap.xml` returns 24 URLs with new resource pages and no legacy Rufo noise; `/robots.txt`, `/llms.txt`, `/pricing/`, `/checkout`, and `/api/runtime` returned expected live responses.
- Deployment/Git status: Production deploy completed; changelog verification entry pending commit/push at entry time.
- Follow-up items: Full `npm test` still has an unrelated existing failure in `test/analytics-flow.test.mjs` at visitor analytics assertion `0 !== 1`; SEO, Worker, and build verification passed.

## 2026-06-08 16:06:51 CST - SEO/GEO + Build Checklist Repair

Scope: repaired P0/P1 checklist issues for ruflo.online.

Touched files:
  - ruflo/index.html
  - ruflo/pricing/index.html
  - ruflo/resources/index.html
  - ruflo/dist/index.html
  - ruflo/dist/pricing/index.html
  - ruflo/dist/resources/index.html
  - ruflo/public/pricing/index.html
  - ruflo/public/resources/index.html
  - ruflo/worker/index.js

Verification: ran the shared SEO/GEO patrol fixer from the latest all-sites checklist input; 9router build also passed after shared route guard changes.

Deploy/Git status: pending commit, push, deploy, and post-deploy checklist rerun.

Follow-ups: re-run the all-sites SEO/GEO + build checklist after production deployment and keep any DNS/account-only blockers in the issue ledger.

## 2026-06-12 exposure rescue pages

- Added AI-readable and human-useful static intent pages for uncovered traffic terms: `ruflow ai`.
- Replaced the old hidden SEO answer block with a readable first-packet fallback inside `#root` where an index shell exists.
- Refreshed pricing, checkout fallback, privacy, terms, sitemap, robots, and llms surfaces for the exposure-click rescue checklist.
- Verification pending: rebuild/deploy and rerun the exposure rescue checklist.

## 2026-07-01 - MiroFish contextual reference

- Added one contextual related-resource link to MiroFish AI Simulator with UTM tracking for ruflo.online.
- Placement rule: secondary Resources/Source context when available, otherwise the homepage tail; no hero, nav, pricing, checkout, or primary CTA links were changed.
- SEO safety: brand anchor only, one link per canonical site surface, visible editorial context, and no keyword-stuffed footer/sitewide block.
- Verification pending: run the site build/deploy workflow and live link checks after all portfolio edits are applied.
