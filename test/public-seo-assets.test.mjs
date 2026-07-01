import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const liveOrigin = 'https://ruflo.online'

const expectedMarketingUrls = [
  `${liveOrigin}/`,
  `${liveOrigin}/docs/`,
  `${liveOrigin}/features/`,
  `${liveOrigin}/github/`,
  `${liveOrigin}/guides/`,
  `${liveOrigin}/how-it-works/`,
  `${liveOrigin}/use-cases/`,
  `${liveOrigin}/compare/ruflo-vs-single-agent-tools`,
  `${liveOrigin}/compare/hosted-ruflo-vs-self-hosting`,
  `${liveOrigin}/solutions/codebase-swarms`,
  `${liveOrigin}/solutions/research-memory`,
  `${liveOrigin}/solutions/team-agent-ops`,
  `${liveOrigin}/resources/ruflo-ai`,
  `${liveOrigin}/resources/how-to-use-ruflo`,
  `${liveOrigin}/resources/ruflo-github`,
  `${liveOrigin}/resources/ruflo-reddit`,
  `${liveOrigin}/resources/ruflo-codex`,
  `${liveOrigin}/resources/ruflo-claude-code`,
  `${liveOrigin}/resources/hosted-multi-agent-workspaces`,
  `${liveOrigin}/resources/multi-agent-coding-workflows`,
  `${liveOrigin}/resources/ai-agent-memory-rag`,
  `${liveOrigin}/resources/goal-planner-ui`,
  `${liveOrigin}/resources/codebase-planning-review`,
  `${liveOrigin}/resources/team-agent-operations`,
  `${liveOrigin}/resources/is-ruflo-legit`,
  `${liveOrigin}/resources/ruflo-ui`,
  `${liveOrigin}/resources/`,
  `${liveOrigin}/privacy/`,
  `${liveOrigin}/terms/`,
  `${liveOrigin}/plans`,
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('static SEO assets point at the live Ruflo origin', () => {
  const indexHtml = readFileSync(join(projectRoot, 'index.html'), 'utf8')
  const robotsTxt = readFileSync(join(projectRoot, 'public', 'robots.txt'), 'utf8')
  const sitemapXml = readFileSync(join(projectRoot, 'public', 'sitemap.xml'), 'utf8')

  assert.match(indexHtml, new RegExp(`<link rel="canonical" href="${escapeRegExp(`${liveOrigin}/`)}" \\/>`))
  assert.match(indexHtml, new RegExp(`<meta property="og:url" content="${escapeRegExp(`${liveOrigin}/`)}" \\/>`))
  assert.match(indexHtml, new RegExp(`<meta property="og:image" content="${escapeRegExp(`${liveOrigin}/og-image.png`)}" \\/>`))
  assert.match(indexHtml, new RegExp(`<meta name="twitter:image" content="${escapeRegExp(`${liveOrigin}/og-image.png`)}" \\/>`))
  assert.match(indexHtml, /<meta\s+name="keywords"\s+content="[^"]*hosted multi-agent workspaces[^"]*Codex workflow[^"]*Claude Code workflow[^"]*RAG workflow[^"]*team agent operations[^"]*"/)
  assert.doesNotMatch(indexHtml, /github\.com\/ruvnet\/ruflo/)
  assert.doesNotMatch(indexHtml, /seo-geo-answer-section/)
  assert.match(indexHtml, /"name":"Growth monthly","price":"49"/)

  assert.match(robotsTxt, new RegExp(`^Sitemap: ${escapeRegExp(`${liveOrigin}/sitemap.xml`)}$`, 'm'))
  assert.match(robotsTxt, /^Content-Signal: search=yes,ai-input=yes,ai-train=no$/m)

  assert.match(sitemapXml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
  assert.doesNotMatch(sitemapXml, /<urlset[^>]*\/>/)
  assert.doesNotMatch(sitemapXml, /chris-rufo|christopher-rufo|christopher-ruffo|rufo-twitter/i)
  assert.equal(sitemapXml.match(/<url>/g)?.length ?? 0, expectedMarketingUrls.length)

  for (const url of expectedMarketingUrls) {
    assert.match(sitemapXml, new RegExp(`<loc>${escapeRegExp(url)}</loc>`))
  }
})
