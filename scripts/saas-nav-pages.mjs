import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const site = {
  "dir": "ruflo",
  "domain": "ruflo.online",
  "name": "Ruflo AI",
  "shortName": "Ruflo",
  "category": "hosted Ruflo workspace and AI coding orchestration launch layer",
  "audience": "coding teams, automation operators, and builders who want a repeatable Ruflo workspace instead of a one-off local setup",
  "oneLine": "Ruflo AI helps teams plan, pay for, provision, and operate Ruflo workspaces with entrypoint choices, console access, and model-route context.",
  "repoName": "ruflo-online-docs",
  "upstreamName": "Ruflo",
  "upstreamRepo": "https://github.com/ruvnet/ruflo",
  "pricing": "Plans cover hosted workspace capacity, model-route setup, console access, and operational support for repeatable Ruflo work.",
  "ctaPath": "/plans",
  "disclaimer": "Ruflo AI is a hosted workspace layer around Ruflo-style workflows; the upstream open-source project remains separate.",
  "features": [
    [
      "Workspace provisioning",
      "Move from plan selection to a usable Ruflo workspace without stitching together every setup step by hand."
    ],
    [
      "Entrypoint choice",
      "Select the route that fits the work: coding, automation, agent orchestration, or team review."
    ],
    [
      "Console visibility",
      "Keep plan, workspace, launch status, and follow-up actions in a single operating surface."
    ],
    [
      "Model and tool context",
      "Record model route, tool assumptions, memory expectations, and credential boundary before work begins."
    ],
    [
      "Payment-aware access",
      "Connect checkout state to workspace capacity so buyers know what is unlocked."
    ],
    [
      "Self-host comparison",
      "Help users decide whether the upstream repo, a local setup, or a hosted workspace is the better next step."
    ]
  ],
  "workflow": [
    [
      "Define the workstream",
      "Choose whether Ruflo will support coding, workflow automation, review loops, or a mixed agent workspace."
    ],
    [
      "Choose plan and entrypoint",
      "Pick capacity, model route, and workspace entrypoint before checkout."
    ],
    [
      "Provision the workspace",
      "Create the workspace state, console access, and operational notes after payment confirmation."
    ],
    [
      "Operate and refine",
      "Use the console to review launches, adjust entrypoints, and add capacity when work expands."
    ]
  ],
  "useCases": [
    [
      "AI coding workspace",
      "Give a developer team a repeatable Ruflo environment for agent-assisted coding tasks."
    ],
    [
      "Automation pilot",
      "Test a recurring workflow without making every operator self-host the stack."
    ],
    [
      "Agency delivery",
      "Run several client workspaces with a consistent provisioning and support path."
    ],
    [
      "Repo-to-product evaluation",
      "Start with the GitHub project, then decide when hosted operations are worth paying for."
    ]
  ],
  "guides": [
    [
      "Read the Ruflo repo first",
      "Inspect the upstream README, supported routes, examples, and issue history before buying a managed workspace."
    ],
    [
      "Prepare workspace credentials",
      "List the tools, repositories, and credentials the workspace needs, then remove anything not required for the first run."
    ],
    [
      "Choose hosted vs. self-hosted",
      "Self-host when infrastructure control dominates; use hosted when repeatable launch, billing, and support are the bottleneck."
    ]
  ],
  "docs": [
    [
      "Workspace facts",
      "Plan, billing cycle, entrypoint, selected model route, console URL, and support state are the key operating fields."
    ],
    [
      "Security notes",
      "Credentials should be scoped to the workspace purpose and rotated if the workflow changes."
    ],
    [
      "Support notes",
      "Support focuses on workspace launch, checkout, access state, and operational handoff."
    ]
  ],
  "limits": [
    "Hosted Ruflo does not guarantee third-party model, repository, or credential provider availability.",
    "Teams remain responsible for code review and production decisions made from agent output.",
    "Custom enterprise infrastructure may still require a self-hosted or private deployment path."
  ],
  "origin": "https://ruflo.online",
  "docsRepo": "https://github.com/clauxel/ruflo-online-docs",
  "support": "support@aigeamy.com",
  "aliases": [],
  "extraLinks": [],
  "rootPages": false
}
const navPages = [
  {
    "slug": "features",
    "label": "Features"
  },
  {
    "slug": "how-it-works",
    "label": "How It Works"
  },
  {
    "slug": "use-cases",
    "label": "Use Cases"
  },
  {
    "slug": "guides",
    "label": "Guides"
  },
  {
    "slug": "docs",
    "label": "Docs"
  },
  {
    "slug": "github",
    "label": "GitHub"
  }
]
const directoryCanonicalPaths = new Set([
  ...navPages.map((page) => '/' + page.slug),
  '/pricing',
  '/resources',
  '/privacy',
  '/terms',
])
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const today = new Date().toISOString().slice(0, 10)

await writeAll()

async function writeAll() {
  const roots = await targetRoots()
  for (const root of roots) {
    await writeNavPages(root)
    await upsertSitemap(root)
    await upsertRobots(root)
    await upsertLlms(root)
  }
  await patchWorkerRoutes()
  console.log('[saas-nav] wrote ' + navPages.length + ' pages for ' + site.domain + ' into ' + roots.map((root) => path.relative(projectRoot, root) || '.').join(', '))
}

async function targetRoots() {
  const candidates = []
  if (await exists(path.join(projectRoot, 'public'))) candidates.push(path.join(projectRoot, 'public'))
  if (await exists(path.join(projectRoot, 'dist'))) candidates.push(path.join(projectRoot, 'dist'))
  if (await exists(path.join(projectRoot, 'out'))) candidates.push(path.join(projectRoot, 'out'))
  if (await exists(path.join(projectRoot, 'dist-pages'))) candidates.push(path.join(projectRoot, 'dist-pages'))
  if (site.rootPages) candidates.push(projectRoot)
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
}

async function writeNavPages(root) {
  for (const navPage of navPages) {
    const outputDir = path.join(root, navPage.slug)
    await fs.mkdir(outputDir, { recursive: true })
    await fs.writeFile(path.join(outputDir, 'index.html'), renderPage(navPage), 'utf8')
  }
}

async function upsertSitemap(root) {
  const filePath = path.join(root, 'sitemap.xml')
  const current = await readIfExists(filePath)
  const urls = new Set()
  if (current) {
    for (const match of current.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(normalizeSitemapUrl(match[1]))
  }
  urls.add(site.origin + '/')
  urls.add(canonical('/pricing/'))
  urls.add(canonical('/plans'))
  for (const navPage of navPages) urls.add(canonical('/' + navPage.slug + '/'))
  const body = [...urls]
    .sort()
    .map((url) => {
      const isHome = url === site.origin + '/'
      const isPricing = /\/(?:plans|pricing)\/?$/.test(url)
      return '  <url>\n    <loc>' + escapeXml(url) + '</loc>\n    <lastmod>' + today + '</lastmod>\n    <changefreq>' + (isHome || isPricing ? 'weekly' : 'monthly') + '</changefreq>\n    <priority>' + (isHome ? '1.0' : isPricing ? '0.9' : '0.78') + '</priority>\n  </url>'
    })
    .join('\n')
  await fs.writeFile(filePath, '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + '\n</urlset>\n', 'utf8')
}

async function upsertRobots(root) {
  const filePath = path.join(root, 'robots.txt')
  const current = await readIfExists(filePath)
  const sitemapLine = 'Sitemap: ' + site.origin + '/sitemap.xml'
  if (current && current.includes(sitemapLine)) return
  const base = current && current.trim() ? current.trim().replace(/Sitemap: .*$/gmi, '').trim() : 'User-agent: *\nAllow: /\nDisallow: /api/'
  await fs.writeFile(filePath, base + '\n' + sitemapLine + '\n', 'utf8')
}

async function upsertLlms(root) {
  const filePath = path.join(root, 'llms.txt')
  const current = (await readIfExists(filePath)) ?? ''
  const start = '<!-- SAAS_NAV_START -->'
  const end = '<!-- SAAS_NAV_END -->'
  const section = start + '\n' + renderLlmsSection() + '\n' + end
  let next = current
  if (next.includes(start) && next.includes(end)) {
    next = next.replace(new RegExp(start + '[\\s\\S]*?' + end), section)
  } else {
    next = (next.trim() ? next.trim() + '\n\n' : '') + section + '\n'
  }
  await fs.writeFile(filePath, next, 'utf8')
}

async function patchWorkerRoutes() {
  const workerPath = path.join(projectRoot, 'worker', 'index.js')
  let worker = await readIfExists(workerPath)
  if (!worker) return
  const navPaths = navPages.map((page) => '/' + page.slug)
  worker = addPathsToArray(worker, 'keywordPaths', navPaths)
  worker = addPathsToArray(worker, 'indexablePaths', navPaths)
  worker = addPathsToStaticSet(worker, navPaths)
  await fs.writeFile(workerPath, worker, 'utf8')

  const htmlMapPath = path.join(projectRoot, 'worker', 'site-html.js')
  let htmlMap = await readIfExists(htmlMapPath)
  if (!htmlMap) return
  const start = '// SAAS_NAV_PAGES_START'
  const end = '// SAAS_NAV_PAGES_END'
  const entries = navPages
    .map((page) => "htmlPages.set('/" + page.slug + "', " + JSON.stringify(renderPage(page)) + ")")
    .join('\n')
  const block = '\n' + start + '\n' + entries + '\n' + end + '\n'
  if (htmlMap.includes(start) && htmlMap.includes(end)) {
    htmlMap = htmlMap.replace(new RegExp('\\n?' + escapeRegExp(start) + '[\\s\\S]*?' + escapeRegExp(end) + '\\n?'), block)
  } else {
    htmlMap += block
  }
  await fs.writeFile(htmlMapPath, htmlMap, 'utf8')
}

function addPathsToArray(source, arrayName, paths) {
  const pattern = new RegExp('const\\s+' + arrayName + '\\s*=\\s*\\[([\\s\\S]*?)\\]','m')
  const match = source.match(pattern)
  if (!match) return source
  if (match[1].includes('...keywordPaths')) return source
  const existing = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1])
  const merged = [...new Set([...existing, ...paths])]
  const replacement = 'const ' + arrayName + ' = [\n' + merged.map((item) => "  '" + item + "',").join('\n') + '\n]'
  return source.replace(pattern, replacement)
}

function addPathsToStaticSet(source, paths) {
  const pattern = /const\s+staticAssetPaths\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/m
  const match = source.match(pattern)
  if (!match) return source
  const existing = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1])
  const merged = [...new Set([...existing, ...paths])]
  const body = match[1].includes('...indexablePaths')
    ? match[1].replace(/\n\]/, '')
    : '\n' + merged.map((item) => "  '" + item + "',").join('\n')
  const missing = paths.filter((item) => !match[1].includes("'" + item + "'") && !match[1].includes('"' + item + '"'))
  if (missing.length === 0) return source
  const insertion = missing.map((item) => "  '" + item + "',").join('\n')
  return source.replace(pattern, (full, inside) => {
    const trimmed = inside.trimEnd()
    return 'const staticAssetPaths = new Set([' + trimmed + '\n' + insertion + '\n])'
  })
}

function renderPage(navPage) {
  const model = pageModel(navPage.slug)
  const title = model.title
  const description = model.description
  const canonicalUrl = canonical('/' + navPage.slug)
  const schema = buildSchema(navPage, model, canonicalUrl)
  return '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>' + escapeHtml(title) + '</title>\n  <meta name="description" content="' + escapeAttr(description) + '">\n  <meta name="robots" content="index,follow">\n  <link rel="canonical" href="' + escapeAttr(canonicalUrl) + '">\n  <link rel="alternate" type="text/plain" href="' + site.origin + '/llms.txt" title="llms.txt">\n  <meta property="og:type" content="website">\n  <meta property="og:title" content="' + escapeAttr(title) + '">\n  <meta property="og:description" content="' + escapeAttr(description) + '">\n  <meta property="og:url" content="' + escapeAttr(canonicalUrl) + '">\n  <meta name="twitter:card" content="summary">\n  <meta name="twitter:title" content="' + escapeAttr(title) + '">\n  <meta name="twitter:description" content="' + escapeAttr(description) + '">\n  <style>' + css() + '</style>\n  <script type="application/ld+json">' + jsonForHtml(schema) + '</script>\n</head>\n<body>\n  <header class="topbar">\n    <a class="brand" href="/"><span>' + escapeHtml(site.shortName) + '</span><small>' + escapeHtml(site.category) + '</small></a>\n    <nav aria-label="Primary navigation">' + navPages.map((page) => '<a href="/' + page.slug + '/" ' + (page.slug === navPage.slug ? 'aria-current="page"' : '') + '>' + escapeHtml(page.label) + '</a>').join('') + '<a href="' + escapeAttr(site.ctaPath) + '">Pricing</a></nav>\n  </header>\n  <main>\n    <section class="hero">\n      <p class="eyebrow">' + escapeHtml(site.domain) + ' / ' + escapeHtml(navPage.label) + '</p>\n      <h1>' + escapeHtml(model.h1) + '</h1>\n      <p class="lead">' + escapeHtml(model.lead) + '</p>\n      <div class="actions"><a class="button primary" href="' + escapeAttr(site.ctaPath) + '">View pricing or start</a><a class="button" href="' + escapeAttr(site.docsRepo) + '">Open docs repository</a></div>\n    </section>\n    ' + renderQuickFacts() + renderSections(model.sections) + renderUsefulChecks(model) + renderLimits() + renderFaq(model) + '\n  </main>\n  <footer>\n    <strong>' + escapeHtml(site.name) + '</strong>\n    <span>' + escapeHtml(site.disclaimer) + '</span>\n    <nav><a href="/">Home</a><a href="/sitemap.xml">Sitemap</a><a href="/llms.txt">llms.txt</a><a href="mailto:' + site.support + '">' + site.support + '</a></nav>\n  </footer>\n</body>\n</html>\n'
}

function pageModel(slug) {
  if (slug === 'features') {
    return {
      title: 'Features - ' + site.name + ' for ' + site.category,
      h1: site.name + ' features for real ' + site.shortName + ' workflows',
      description: site.name + ' features, limits, pricing context, and workflow details for ' + site.category + '.',
      lead: site.oneLine + ' This page names the concrete feature surface so search engines and buyers can understand what the product actually does.',
      sections: [
        { title: 'Core features', type: 'cards', items: site.features },
        { title: 'What users get from the product', type: 'paragraphs', items: [site.pricing, 'The useful output is not just a landing page claim. Users should leave with a clearer workflow, an obvious first action, and a visible boundary for what the product will not do.'] },
      ],
      faqs: [
        ['What is ' + site.name + '?', site.oneLine],
        ['Who is it for?', 'It is built for ' + site.audience + '.'],
        ['Where should I start?', 'Start with the pricing or product flow, then use the Docs and Guides pages for setup details.'],
      ],
    }
  }
  if (slug === 'how-it-works') {
    return {
      title: 'How It Works - ' + site.name + ' workflow',
      h1: 'How ' + site.name + ' works from first input to useful output',
      description: 'Step-by-step workflow for ' + site.name + ', including inputs, review steps, outputs, pricing context, and limits.',
      lead: 'The workflow is intentionally concrete: users need to know what to prepare, what the product checks, what comes out, and when a human should review the result.',
      sections: [
        { title: 'Workflow steps', type: 'steps', items: site.workflow },
        { title: 'Inputs and outputs', type: 'paragraphs', items: ['Typical inputs: ' + site.docs[0][1], 'Expected outputs: ' + site.docs[1][1], site.pricing] },
      ],
      faqs: [
        ['Do I need a developer to start?', 'Not always. The hosted workflow is designed to make the first useful step visible, while technical teams can still inspect linked repositories and docs.'],
        ['What happens after checkout?', 'Paid access unlocks the workflow capacity described on the pricing page and keeps the original product context available for review.'],
        ['What should I review manually?', site.limits[0]],
      ],
    }
  }
  if (slug === 'use-cases') {
    return {
      title: 'Use Cases - ' + site.name + ' practical workflows',
      h1: site.name + ' use cases and buyer-fit examples',
      description: 'Practical use cases for ' + site.name + ', with when-to-use guidance, limits, and next steps.',
      lead: 'These use cases are written for people deciding whether the product fits a real job, not for generic traffic.',
      sections: [
        { title: 'Best-fit use cases', type: 'cards', items: site.useCases },
        { title: 'When this is a strong fit', type: 'list', items: ['The user has a repeatable workflow, not a one-time curiosity.', 'The output needs reviewable evidence, saved context, or team handoff.', 'The buyer wants visible pricing, support expectations, and a safer operating path.'] },
      ],
      faqs: [
        ['Which use case should I start with?', 'Start with the narrowest workflow where ' + site.name + ' can produce a useful artifact quickly.'],
        ['Can one product cover every workflow?', 'No. The best results come from using the product where its category fits: ' + site.category + '.'],
        ['Where are the setup details?', 'Use the Guides and Docs pages for setup steps, input fields, and output expectations.'],
      ],
    }
  }
  if (slug === 'guides') {
    return {
      title: 'Guides - ' + site.name + ' setup and review playbooks',
      h1: site.name + ' guides for setup, review, and safe handoff',
      description: 'Guides for using ' + site.name + ' with concrete review steps, repository context, and product limits.',
      lead: 'Good guides reduce uncertainty. They tell users what to prepare, what to check, and when to stop or escalate.',
      sections: [
        { title: 'Guides', type: 'cards', items: site.guides },
        { title: 'Review before you rely on an output', type: 'list', items: ['Confirm the input belongs in this workflow.', 'Check the product output against the original source or operating context.', 'Record the owner, date, and next action when the result will be shared.'] },
      ],
      faqs: [
        ['Are these guides a replacement for upstream documentation?', 'No. They help users operate this hosted workflow and should be paired with upstream docs where relevant.'],
        ['What is the safest first guide?', site.guides[0][1]],
        ['How do teams keep outputs useful?', 'Use the same input fields, review list, and owner notes every time.'],
      ],
    }
  }
  if (slug === 'docs') {
    return {
      title: 'Docs - ' + site.name + ' product reference',
      h1: site.name + ' docs: inputs, outputs, pricing, support, and limits',
      description: 'Documentation index for ' + site.name + ', covering input fields, output contract, support boundary, pricing context, and linked repositories.',
      lead: 'This docs page gives AI crawlers and human users a clean product reference: what the service is, what to submit, what comes back, and where the boundaries are.',
      sections: [
        { title: 'Product reference', type: 'cards', items: site.docs },
        { title: 'Canonical product links', type: 'links', items: [['Homepage', site.origin + '/'], ['Pricing', canonical(site.ctaPath)], ['Docs repository', site.docsRepo], ...(site.upstreamRepo ? [[site.upstreamName + ' upstream repository', site.upstreamRepo]] : []), ...site.extraLinks.map((link, index) => ['External reference ' + (index + 1), link])] },
      ],
      faqs: [
        ['What is the canonical domain?', site.domain + ' is the canonical public domain for these docs pages.'],
        ['Where is the GitHub documentation?', 'The product docs repository is ' + site.docsRepo + '.'],
        ['How do I contact support?', 'Support can be reached at ' + site.support + '.'],
      ],
    }
  }
  return {
    title: 'GitHub - ' + site.name + ' docs repository and source context',
    h1: site.name + ' GitHub docs and repository context',
    description: 'GitHub documentation repository, upstream source context, and evaluation notes for ' + site.name + '.',
    lead: 'This page separates product documentation, upstream source code, and managed service value so buyers do not confuse a repository with the hosted workflow.',
    sections: [
      { title: 'GitHub links', type: 'links', items: [['Product docs repository', site.docsRepo], ...(site.upstreamRepo ? [[site.upstreamName + ' upstream repository', site.upstreamRepo]] : []), ...site.extraLinks.map((link, index) => ['External reference ' + (index + 1), link])] },
      { title: 'What to inspect before relying on GitHub', type: 'list', items: ['Read the README and setup path.', 'Check supported inputs, outputs, deployment assumptions, and licenses.', 'Review recent issues or release notes when technical freshness matters.', 'Decide what belongs in self-hosted code and what belongs in the hosted workflow.'] },
      { title: 'Managed service value', type: 'paragraphs', items: [site.pricing, site.disclaimer] },
    ],
    faqs: [
      ['Is the docs repo the same as the upstream source repository?', 'No. The docs repo explains this hosted product. The upstream source repository remains separate when one is listed.'],
      ['Should technical buyers inspect GitHub first?', 'Yes. GitHub is useful for source review, while the hosted site explains pricing, support, workflow, and checkout.'],
      ['What should non-technical users read?', 'Start with Features, How It Works, Use Cases, and Docs before opening source code.'],
    ],
  }
}

function renderQuickFacts() {
  const rows = [
    ['Product', site.name],
    ['Canonical domain', site.domain],
    ['Category', site.category],
    ['Audience', site.audience],
    ['Pricing context', site.pricing],
    ['Docs repository', site.docsRepo],
  ]
  if (site.aliases.length) rows.push(['Also served on', site.aliases.join(', ')])
  if (site.upstreamRepo) rows.push(['Upstream source context', site.upstreamName + ' - ' + site.upstreamRepo])
  return '<section class="band"><div class="section-head"><p class="eyebrow">Quick facts</p><h2>What this page says clearly</h2></div><dl class="facts">' + rows.map(([key, value]) => '<div><dt>' + escapeHtml(key) + '</dt><dd>' + linkify(value) + '</dd></div>').join('') + '</dl></section>'
}

function renderSections(sections) {
  return sections.map((section) => {
    if (section.type === 'cards') {
      return '<section class="band"><div class="section-head"><p class="eyebrow">Useful detail</p><h2>' + escapeHtml(section.title) + '</h2></div><div class="grid cards">' + section.items.map(([title, copy]) => '<article><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(copy) + '</p></article>').join('') + '</div></section>'
    }
    if (section.type === 'steps') {
      return '<section class="band"><div class="section-head"><p class="eyebrow">Process</p><h2>' + escapeHtml(section.title) + '</h2></div><ol class="steps">' + section.items.map(([title, copy]) => '<li><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(copy) + '</span></li>').join('') + '</ol></section>'
    }
    if (section.type === 'list') {
      return '<section class="band"><div class="section-head"><p class="eyebrow">Review list</p><h2>' + escapeHtml(section.title) + '</h2></div><ul class="review-list">' + section.items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></section>'
    }
    if (section.type === 'links') {
      return '<section class="band"><div class="section-head"><p class="eyebrow">References</p><h2>' + escapeHtml(section.title) + '</h2></div><div class="link-list">' + section.items.map(([label, href]) => '<a href="' + escapeAttr(href) + '">' + escapeHtml(label) + '<span>' + escapeHtml(href) + '</span></a>').join('') + '</div></section>'
    }
    return '<section class="band"><div class="section-head"><p class="eyebrow">Context</p><h2>' + escapeHtml(section.title) + '</h2></div><div class="prose">' + section.items.map((item) => '<p>' + escapeHtml(item) + '</p>').join('') + '</div></section>'
  }).join('')
}

function renderUsefulChecks(model) {
  return '<section class="band contrast"><div class="section-head"><p class="eyebrow">SEO and GEO clarity</p><h2>Entity, intent, and answer checks</h2></div><div class="grid cards"><article><h3>Entity definition</h3><p>' + escapeHtml(site.name + ' is a ' + site.category + ' at ' + site.domain + '.') + '</p></article><article><h3>User intent</h3><p>' + escapeHtml(model.description) + '</p></article><article><h3>Next action</h3><p>Use the pricing flow, docs repository, or upstream source link depending on whether the user wants to buy, understand, or inspect code.</p></article></div></section>'
}

function renderLimits() {
  return '<section class="band"><div class="section-head"><p class="eyebrow">Limits</p><h2>Important boundaries</h2></div><ul class="review-list">' + site.limits.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '<li>' + escapeHtml(site.disclaimer) + '</li></ul></section>'
}

function renderFaq(model) {
  return '<section class="band"><div class="section-head"><p class="eyebrow">FAQ</p><h2>Questions this page answers</h2></div><div class="grid cards">' + model.faqs.map(([question, answer]) => '<article><h3>' + escapeHtml(question) + '</h3><p>' + escapeHtml(answer) + '</p></article>').join('') + '</div></section>'
}

function buildSchema(navPage, model, canonicalUrl) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: site.name,
        url: site.origin + '/',
        email: site.support,
        sameAs: [site.docsRepo, site.upstreamRepo, ...site.extraLinks].filter(Boolean),
      },
      {
        '@type': 'SoftwareApplication',
        name: site.name,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: site.origin + '/',
        description: site.oneLine,
        offers: { '@type': 'Offer', url: canonical(site.ctaPath), availability: 'https://schema.org/InStock' },
      },
      {
        '@type': 'WebPage',
        name: model.title,
        description: model.description,
        url: canonicalUrl,
        isPartOf: { '@type': 'WebSite', name: site.name, url: site.origin + '/' },
        about: { '@type': 'Thing', name: site.category },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: site.origin + '/' },
          { '@type': 'ListItem', position: 2, name: navPage.label, item: canonicalUrl },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: model.faqs.map(([question, answer]) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  }
}

function renderLlmsSection() {
  const lines = [
    '# ' + site.name + ' navigation reference',
    '',
    site.oneLine,
    '',
    'Canonical domain: ' + site.origin + '/',
    'Category: ' + site.category,
    'Audience: ' + site.audience,
    'Pricing: ' + site.pricing,
    'Support: ' + site.support,
    'Docs repository: ' + site.docsRepo,
  ]
  if (site.aliases.length) lines.push('Also served on: ' + site.aliases.map((alias) => 'https://' + alias).join(', '))
  if (site.upstreamRepo) lines.push('Upstream source context: ' + site.upstreamName + ' - ' + site.upstreamRepo)
  lines.push('', 'Public navigation pages:')
  for (const page of navPages) lines.push('- ' + page.label + ': ' + canonical('/' + page.slug + '/'))
  lines.push('- Pricing: ' + canonical(site.ctaPath), '', 'Important limits:')
  for (const limit of site.limits) lines.push('- ' + limit)
  lines.push('- ' + site.disclaimer)
  return lines.join('\n')
}

function canonical(inputPath) {
  if (/^https?:\/\//i.test(inputPath)) return inputPath
  const clean = ('/' + String(inputPath).replace(/^\/+/g, '')).replace(/\/index\.html$/i, '/')
  if (clean === '/') return site.origin + '/'
  const normalized = clean.replace(/\/+$/, '')
  if (directoryCanonicalPaths.has(normalized)) return site.origin + normalized + '/'
  return site.origin + normalized
}

function normalizeSitemapUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.origin !== site.origin) return rawUrl
    const normalizedPath = url.pathname.replace(/\/+$/, '') || '/'
    if (directoryCanonicalPaths.has(normalizedPath)) {
      url.pathname = normalizedPath + '/'
      return url.toString()
    }
  } catch {
    return rawUrl
  }

  return rawUrl
}

function linkify(value) {
  const escaped = escapeHtml(value)
  return escaped.replace(/https:\/\/[^\s,]+/g, (url) => '<a href="' + escapeAttr(url) + '">' + escapeHtml(url) + '</a>')
}

function css() {
  return ':root{color-scheme:light;--ink:#172026;--muted:#5f6b73;--line:#d9e2e8;--soft:#f5f8fa;--accent:#0b6f82;--accent2:#8b4d12;--paper:#ffffff}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper);letter-spacing:0}a{color:inherit}.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem clamp(1rem,4vw,3rem);border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);backdrop-filter:blur(14px)}.brand{display:grid;text-decoration:none}.brand span{font-weight:850}.brand small{color:var(--muted);font-size:.78rem}.topbar nav{display:flex;gap:.8rem;flex-wrap:wrap;align-items:center}.topbar nav a{font-size:.92rem;color:var(--muted);text-decoration:none}.topbar nav a[aria-current=page]{color:var(--accent);font-weight:800}.hero{padding:clamp(3rem,7vw,6rem) clamp(1rem,5vw,5rem);background:linear-gradient(135deg,#eef7f9 0%,#ffffff 48%,#fff6eb 100%);border-bottom:1px solid var(--line)}.eyebrow{margin:0 0 .6rem;color:var(--accent2);font-size:.82rem;text-transform:uppercase;font-weight:800}h1{max-width:960px;margin:0 0 1rem;font-size:clamp(2.1rem,5vw,4.4rem);line-height:1;letter-spacing:0}h2{margin:0 0 .6rem;font-size:clamp(1.55rem,3vw,2.6rem);line-height:1.05}h3{margin:.1rem 0 .45rem;font-size:1.05rem}.lead{max-width:880px;color:#39474f;font-size:1.08rem;line-height:1.65}.actions{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.2rem}.button{display:inline-flex;align-items:center;justify-content:center;min-height:2.7rem;padding:.75rem 1rem;border:1px solid var(--line);border-radius:8px;text-decoration:none;font-weight:750;background:#fff}.button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.band{padding:clamp(2.2rem,5vw,4.4rem) clamp(1rem,5vw,5rem);border-bottom:1px solid var(--line)}.band.contrast{background:var(--soft)}.section-head{max-width:940px;margin-bottom:1.2rem}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.cards article,.facts div,.link-list a{border:1px solid var(--line);border-radius:8px;background:#fff;padding:1rem}.cards p,.prose p,.steps span,.review-list li,.facts dd,.link-list span,footer span{color:var(--muted);line-height:1.6}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin:0}.facts dt{font-weight:850;margin-bottom:.25rem}.facts dd{margin:0;overflow-wrap:anywhere}.steps{display:grid;gap:.8rem;counter-reset:step;padding:0;margin:0;list-style:none}.steps li{display:grid;grid-template-columns:3rem 1fr;gap:1rem;padding:1rem;border:1px solid var(--line);border-radius:8px}.steps li:before{counter-increment:step;content:counter(step);display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:999px;background:#e4f3f6;color:var(--accent);font-weight:850}.steps strong{display:block;margin-bottom:.2rem}.review-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;margin:0;padding:0;list-style:none}.review-list li{padding:1rem;border:1px solid var(--line);border-radius:8px;background:#fff}.link-list{display:grid;gap:.75rem}.link-list a{display:grid;gap:.25rem;text-decoration:none;font-weight:800}.link-list span{font-weight:500;overflow-wrap:anywhere}footer{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:2rem clamp(1rem,5vw,5rem);background:#172026;color:#fff}footer nav{display:flex;gap:.8rem;flex-wrap:wrap}footer a{color:#fff}@media(max-width:900px){.grid,.facts,.review-list{grid-template-columns:1fr}.topbar{align-items:flex-start;flex-direction:column}.steps li{grid-template-columns:1fr}h1{font-size:clamp(2rem,10vw,3.1rem)}}'
}

async function exists(filePath) {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escapeAttr(value) {
  return escapeHtml(value)
}

function escapeXml(value) {
  return escapeHtml(value)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/[{}]/g, '\\$&')
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
