import type { ComparisonPage, ResourcePage, RouteView, SolutionPage } from '../app-types'

const defaultSiteTitle = 'Ruflo AI - Hosted Multi-Agent Workspaces'
const defaultSiteDescription =
  'Launch hosted Ruflo workspaces for Codex, Claude Code, Goal Planner UI, memory, RAG, and multi-agent codebase workflows.'
const defaultSiteKeywords = [
  'Ruflo AI',
  'hosted Ruflo workspace',
  'hosted multi-agent workspaces',
  'multi-agent coding workflows',
  'Codex workflow',
  'Claude Code workflow',
  'Goal Planner UI',
  'AI agent memory',
  'RAG workflow',
  'codebase planning',
  'repository review',
  'team agent operations',
]

const canonicalLinkId = 'ruflo-canonical-link'
const structuredDataScriptId = 'ruflo-structured-data'

type StructuredDataRecord = Record<string, unknown>

export type SeoDocument = {
  title: string
  description: string
  keywords: string[]
  canonicalUrl: string
  robots: string
  structuredData: StructuredDataRecord[]
}

type BuildSeoDocumentArgs = {
  pathname: string
  routeView: RouteView
  publicAppOrigin: string
  solutionPage: SolutionPage | null
  comparisonPage: ComparisonPage | null
  resourcePage: ResourcePage | null
}

function normalizePathname(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function normalizeOrigin(origin: string) {
  try {
    return new URL(origin).origin
  } catch {
    return window.location.origin
  }
}

function buildCanonicalUrl(origin: string, pathname: string) {
  return new URL(normalizePathname(pathname), `${normalizeOrigin(origin)}/`).toString()
}

function buildOgImageUrl(origin: string) {
  return new URL('/og-image.png', `${normalizeOrigin(origin)}/`).toString()
}

function buildWebPageStructuredData(title: string, description: string, canonicalUrl: string): StructuredDataRecord {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonicalUrl,
  }
}

function buildBreadcrumbStructuredData(
  origin: string,
  pathname: string,
  currentPageLabel: string,
): StructuredDataRecord | null {
  const normalizedPath = normalizePathname(pathname)

  if (normalizedPath === '/') {
    return null
  }

  const items: Array<{ name: string; item: string }> = [
    {
      name: 'Home',
      item: buildCanonicalUrl(origin, '/'),
    },
  ]

  if (normalizedPath.startsWith('/solutions/')) {
    items.push({
      name: 'Solutions',
      item: buildCanonicalUrl(origin, '/#solutions'),
    })
  } else if (normalizedPath.startsWith('/compare/')) {
    items.push({
      name: 'Compare',
      item: buildCanonicalUrl(origin, '/#compare'),
    })
  } else if (normalizedPath.startsWith('/resources/')) {
    items.push({
      name: 'Resources',
      item: buildCanonicalUrl(origin, '/#resources'),
    })
  } else if (normalizedPath === '/plans') {
    items.push({
      name: 'Pricing',
      item: buildCanonicalUrl(origin, '/#pricing'),
    })
  }

  items.push({
    name: currentPageLabel,
    item: buildCanonicalUrl(origin, normalizedPath),
  })

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.item,
    })),
  }
}

function buildFaqStructuredData(
  faqs: Array<{
    question: string
    answer: unknown
  }>,
): StructuredDataRecord | null {
  const mainEntity = faqs.flatMap((faq) => {
    if (typeof faq.answer !== 'string') {
      return []
    }

    return [
      {
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      },
    ]
  })

  if (mainEntity.length === 0) {
    return null
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity,
  }
}

function buildNotFoundSeoDocument(origin: string, pathname: string): SeoDocument {
  const title = 'Page not found | Ruflo AI'
  const description =
    'This Ruflo AI page could not be matched to a public route. Return to the homepage to continue.'

  return {
    title,
    description,
    keywords: defaultSiteKeywords,
    canonicalUrl: buildCanonicalUrl(origin, pathname),
    robots: 'noindex,follow',
    structuredData: [buildWebPageStructuredData(title, description, buildCanonicalUrl(origin, pathname))],
  }
}

function buildPageKeywords(...groups: Array<string[] | undefined>) {
  const seen = new Set<string>()
  const keywords: string[] = []

  for (const group of groups) {
    for (const keyword of group ?? []) {
      const normalized = keyword.trim()
      const key = normalized.toLowerCase()

      if (!normalized || seen.has(key)) {
        continue
      }

      seen.add(key)
      keywords.push(normalized)
    }
  }

  return keywords
}

export function buildSeoDocument({
  pathname,
  routeView,
  publicAppOrigin,
  solutionPage,
  comparisonPage,
  resourcePage,
}: BuildSeoDocumentArgs): SeoDocument {
  const normalizedPath = normalizePathname(pathname)
  const canonicalUrl = buildCanonicalUrl(publicAppOrigin, normalizedPath)

  if (routeView === 'home' && normalizedPath !== '/') {
    return buildNotFoundSeoDocument(publicAppOrigin, normalizedPath)
  }

  if (routeView === 'solution' && !solutionPage) {
    return buildNotFoundSeoDocument(publicAppOrigin, normalizedPath)
  }

  if (routeView === 'compare' && !comparisonPage) {
    return buildNotFoundSeoDocument(publicAppOrigin, normalizedPath)
  }

  if (routeView === 'resource' && !resourcePage) {
    return buildNotFoundSeoDocument(publicAppOrigin, normalizedPath)
  }

  if (routeView === 'home') {
    return {
      title: defaultSiteTitle,
      description: defaultSiteDescription,
      keywords: defaultSiteKeywords,
      canonicalUrl,
      robots: 'index,follow',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Ruflo AI',
          url: canonicalUrl,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'Ruflo AI',
          url: canonicalUrl,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'Service',
          name: 'Ruflo AI',
          description: defaultSiteDescription,
          serviceType: 'Hosted Ruflo workspace launch',
          provider: {
            '@type': 'Organization',
            name: 'Ruflo AI',
          },
          areaServed: 'Worldwide',
          url: canonicalUrl,
        },
      ],
    }
  }

  if (routeView === 'solution' && solutionPage) {
    const title = `${solutionPage.title} | Ruflo AI`
    const description = `${solutionPage.summary} Launch a Ruflo workspace with multi-agent planning, memory, RAG, and hosted checkout.`

    return {
      title,
      description,
      keywords: buildPageKeywords(
        [solutionPage.label, solutionPage.title, ...solutionPage.outcomes],
        defaultSiteKeywords,
      ),
      canonicalUrl,
      robots: 'index,follow',
      structuredData: [
        buildWebPageStructuredData(title, description, canonicalUrl),
        buildBreadcrumbStructuredData(publicAppOrigin, normalizedPath, solutionPage.title),
        buildFaqStructuredData(solutionPage.faqs),
      ].filter(Boolean) as StructuredDataRecord[],
    }
  }

  if (routeView === 'compare' && comparisonPage) {
    const title = `${comparisonPage.title} | Ruflo AI`
    const description = `${comparisonPage.summary} Compare architecture weight, execution power, memory continuity, and token efficiency before choosing your agent path.`

    return {
      title,
      description,
      keywords: buildPageKeywords(
        [comparisonPage.label, comparisonPage.title, comparisonPage.alternativeName],
        defaultSiteKeywords,
      ),
      canonicalUrl,
      robots: 'index,follow',
      structuredData: [
        buildWebPageStructuredData(title, description, canonicalUrl),
        buildBreadcrumbStructuredData(publicAppOrigin, normalizedPath, comparisonPage.title),
        buildFaqStructuredData(comparisonPage.faqs),
      ].filter(Boolean) as StructuredDataRecord[],
    }
  }

  if (routeView === 'resource' && resourcePage) {
    const title = `${resourcePage.title} | Ruflo AI`
    const description = resourcePage.summary

    return {
      title,
      description,
      keywords: buildPageKeywords(resourcePage.keywords, [resourcePage.label, resourcePage.title], defaultSiteKeywords),
      canonicalUrl,
      robots: 'index,follow',
      structuredData: [
        buildWebPageStructuredData(title, description, canonicalUrl),
        buildBreadcrumbStructuredData(publicAppOrigin, normalizedPath, resourcePage.title),
        buildFaqStructuredData(resourcePage.faqs),
      ].filter(Boolean) as StructuredDataRecord[],
    }
  }

  if (routeView === 'privacy') {
    const title = 'Privacy Policy | Ruflo AI'
    const description =
      'Read how Ruflo AI processes visitor, account, order, payment, provisioning, and support information.'

    return {
      title,
      description,
      keywords: ['Ruflo AI privacy', 'Ruflo AI data processing', ...defaultSiteKeywords],
      canonicalUrl,
      robots: 'index,follow',
      structuredData: [
        buildWebPageStructuredData(title, description, canonicalUrl),
        buildBreadcrumbStructuredData(publicAppOrigin, normalizedPath, 'Privacy Policy'),
      ].filter(Boolean) as StructuredDataRecord[],
    }
  }

  if (routeView === 'terms') {
    const title = 'Terms of Service | Ruflo AI'
    const description =
      'Review the Ruflo AI Terms of Service for account, order, payment, provisioning, console, and support usage.'

    return {
      title,
      description,
      keywords: ['Ruflo AI terms', 'Ruflo AI checkout terms', ...defaultSiteKeywords],
      canonicalUrl,
      robots: 'index,follow',
      structuredData: [
        buildWebPageStructuredData(title, description, canonicalUrl),
        buildBreadcrumbStructuredData(publicAppOrigin, normalizedPath, 'Terms of Service'),
      ].filter(Boolean) as StructuredDataRecord[],
    }
  }

  if (routeView === 'plans') {
    const title = 'Pricing Plans | Ruflo AI'
    const description =
      'Choose a Ruflo AI plan based on workspace volume, then continue into hosted Creem checkout and provisioning tracking.'

    return {
      title,
      description,
      keywords: ['Ruflo AI pricing', 'hosted Ruflo workspace pricing', ...defaultSiteKeywords],
      canonicalUrl,
      robots: 'noindex,follow',
      structuredData: [buildWebPageStructuredData(title, description, canonicalUrl)],
    }
  }

  if (routeView === 'console') {
    const title = 'Console | Ruflo AI'
    const description =
      'Track Ruflo AI orders, provisioning, upgrades, and account operations inside the console.'

    return {
      title,
      description,
      keywords: ['Ruflo AI console', 'hosted Ruflo workspace console', ...defaultSiteKeywords],
      canonicalUrl,
      robots: 'noindex,nofollow',
      structuredData: [buildWebPageStructuredData(title, description, canonicalUrl)],
    }
  }

  return buildNotFoundSeoDocument(publicAppOrigin, normalizedPath)
}

function upsertMeta(attributeName: 'name' | 'property', attributeValue: string, content: string) {
  let element = document.head.querySelector(`meta[${attributeName}="${attributeValue}"]`)

  if (!(element instanceof HTMLMetaElement)) {
    element = document.createElement('meta')
    element.setAttribute(attributeName, attributeValue)
    document.head.appendChild(element)
  }

  element.setAttribute('content', content)
}

function upsertCanonicalLink(href: string) {
  let element =
    (document.head.querySelector(`#${canonicalLinkId}`) as HTMLLinkElement | null) ??
    (document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)

  if (!(element instanceof HTMLLinkElement)) {
    element = document.createElement('link')
    document.head.appendChild(element)
  }

  element.id = canonicalLinkId
  element.rel = 'canonical'
  element.href = href
}

function upsertStructuredData(structuredData: StructuredDataRecord[]) {
  let element = document.head.querySelector(`#${structuredDataScriptId}`) as HTMLScriptElement | null

  if (!(element instanceof HTMLScriptElement)) {
    element = document.createElement('script')
    element.id = structuredDataScriptId
    element.type = 'application/ld+json'
    document.head.appendChild(element)
  }

  const payload =
    structuredData.length <= 1
      ? structuredData[0] ?? {}
      : {
          '@context': 'https://schema.org',
          '@graph': structuredData.map((item) => {
            const { '@context': _context, ...rest } = item
            return rest
          }),
        }

  element.textContent = JSON.stringify(payload)
}

export function syncSeoDocument(seo: SeoDocument) {
  document.title = seo.title
  const ogImageUrl = buildOgImageUrl(new URL(seo.canonicalUrl).origin)

  upsertMeta('name', 'description', seo.description)
  upsertMeta('name', 'keywords', seo.keywords.join(', '))
  upsertMeta('name', 'robots', seo.robots)
  upsertMeta('property', 'og:type', 'website')
  upsertMeta('property', 'og:site_name', 'Ruflo AI')
  upsertMeta('property', 'og:title', seo.title)
  upsertMeta('property', 'og:description', seo.description)
  upsertMeta('property', 'og:url', seo.canonicalUrl)
  upsertMeta('property', 'og:image', ogImageUrl)
  upsertMeta('property', 'og:image:width', '1200')
  upsertMeta('property', 'og:image:height', '630')
  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', seo.title)
  upsertMeta('name', 'twitter:description', seo.description)
  upsertMeta('name', 'twitter:image', ogImageUrl)
  upsertCanonicalLink(seo.canonicalUrl)
  upsertStructuredData(seo.structuredData)
}
