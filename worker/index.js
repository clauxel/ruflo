import { createCatalogHelpers } from '../server-lib/catalog-helpers.mjs'
import { createAnalyticsHelpers } from '../server-lib/analytics-helpers.mjs'
import { annualBillingMultiplier, channelCatalog, modelCatalog, planCatalog } from '../shared/catalog.mjs'
import { handleNowPaymentsCheckout } from './nowpayments.js'

const bodyLimitBytes = 1024 * 1024
const defaultOrigin = 'https://ruflo.online'
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
const guestUserEmail = 'guest@ruflo.local'
const guestCookieName = 'mca_guest'
const sessionCookieName = 'mca_session'
const guestTtlSeconds = 90 * 24 * 60 * 60
const sessionTtlSeconds = 7 * 24 * 60 * 60
const indexableSitemapPaths = [
  '/',
  '/features/',
  '/how-it-works/',
  '/use-cases/',
  '/guides/',
  '/docs/',
  '/github/',
  '/compare/ruflo-vs-single-agent-tools',
  '/compare/hosted-ruflo-vs-self-hosting',
  '/solutions/codebase-swarms',
  '/solutions/research-memory',
  '/solutions/team-agent-ops',
  '/resources/ruflo-ai',
  '/resources/how-to-use-ruflo',
  '/resources/ruflo-github',
  '/resources/ruflo-reddit',
  '/resources/ruflo-codex',
  '/resources/ruflo-claude-code',
  '/resources/hosted-multi-agent-workspaces',
  '/resources/multi-agent-coding-workflows',
  '/resources/ai-agent-memory-rag',
  '/resources/goal-planner-ui',
  '/resources/codebase-planning-review',
  '/resources/team-agent-operations',
  '/resources/is-ruflo-legit',
  '/resources/ruflo-ui',
  '/resources/',
  '/privacy/',
  '/terms/',
  '/plans',
]
const directoryCanonicalPaths = new Set([
  '/features',
  '/how-it-works',
  '/use-cases',
  '/guides',
  '/docs',
  '/github',
  '/resources',
  '/privacy',
  '/terms',
])
const creemProductCache = new Map()

function mirofishUrl(request, content = 'resources_context') {
  const hostname = new URL(request.url).hostname.replace(/^www\./, '').toLowerCase()
  const params = new URLSearchParams({
    utm_source: hostname,
    utm_medium: 'owned_resource',
    utm_campaign: 'portfolio_contextual_backlink',
    utm_content: content,
  })
  return `https://mirofish.work/?${params.toString()}`
}

function withMirofishReference(html, request) {
  const href = mirofishUrl(request)
  let next = html.replace(/https:\/\/mirofish\.work\/\?utm_source=[^"'<\s]+/gi, href)
  if (!/https:\/\/mirofish\.work\/\?utm_source=/i.test(next)) {
    const block = `<section class="mirofish-contextual-reference" data-mirofish-contextual-backlink aria-labelledby="mirofish-contextual-reference-heading" style="max-width:1120px;margin:28px auto;padding:16px;border:1px solid rgba(100,116,139,.28);border-radius:8px;background:rgba(255,255,255,.72);color:inherit">
  <h2 id="mirofish-contextual-reference-heading" style="font-size:18px;line-height:1.25;margin:0 0 8px;letter-spacing:0">Related AI workflow reference</h2>
  <p style="margin:0;color:inherit;opacity:.82">Ruflo readers comparing agent workflow assumptions can also review <a href="${href}" target="_blank" rel="noopener">MiroFish AI Simulator</a>, a companion reference for simulation-style product reasoning.</p>
</section>`
    next = /<\/main>/i.test(next)
      ? next.replace(/<\/main>/i, `${block}\n</main>`)
      : next.replace(/<\/body>/i, `${block}\n</body>`)
  }
  return next
}

const seoPageMap = new Map([
  [
    '/plans',
    {
      title: 'Pricing Plans | Ruflo AI',
      description:
        'Ruflo AI pricing lists Starter at $19/mo, Growth at $49/mo, and Scale at $149/mo with annual checkout and support details.',
      robots: 'index,follow',
      canonicalPath: '/plans',
    },
  ],
  [
    '/resources',
    {
      title: 'Ruflo AI Resources | Hosted workspace guides',
      description:
        'Browse Ruflo AI guides for hosted multi-agent workspaces, Codex, Claude Code, GitHub evaluation, pricing, privacy, and checkout readiness.',
      robots: 'index,follow',
      canonicalPath: '/resources/',
    },
  ],
  [
    '/features',
    {
      title: 'Features - Ruflo AI for hosted Ruflo workspace and AI coding orchestration launch layer',
      description:
        'Ruflo AI features, limits, pricing context, and workflow details for hosted Ruflo workspace and AI coding orchestration launch layer.',
      robots: 'index,follow',
      canonicalPath: '/features/',
    },
  ],
  [
    '/how-it-works',
    {
      title: 'How It Works - Ruflo AI workflow',
      description:
        'Step-by-step workflow for Ruflo AI, including inputs, review steps, outputs, pricing context, and limits.',
      robots: 'index,follow',
      canonicalPath: '/how-it-works/',
    },
  ],
  [
    '/use-cases',
    {
      title: 'Use Cases - Ruflo AI practical workflows',
      description: 'Practical use cases for Ruflo AI, with when-to-use guidance, limits, and next steps.',
      robots: 'index,follow',
      canonicalPath: '/use-cases/',
    },
  ],
  [
    '/guides',
    {
      title: 'Guides - Ruflo AI setup and review playbooks',
      description: 'Guides for using Ruflo AI with concrete review steps, repository context, and product limits.',
      robots: 'index,follow',
      canonicalPath: '/guides/',
    },
  ],
  [
    '/docs',
    {
      title: 'Docs - Ruflo AI product reference',
      description:
        'Documentation index for Ruflo AI, covering input fields, output contract, support boundary, pricing context, and linked repositories.',
      robots: 'index,follow',
      canonicalPath: '/docs/',
    },
  ],
  [
    '/github',
    {
      title: 'GitHub - Ruflo AI docs repository and source context',
      description: 'GitHub documentation repository, upstream source context, and evaluation notes for Ruflo AI.',
      robots: 'index,follow',
      canonicalPath: '/github/',
    },
  ],
  [
    '/',
    {
      title: defaultSiteTitle,
      description: defaultSiteDescription,
      robots: 'index,follow',
    },
  ],
  [
    '/compare/ruflo-vs-single-agent-tools',
    {
      title: 'Ruflo vs single-agent coding tools | Ruflo AI',
      description:
        'Compare Ruflo with single-agent coding tools when your team needs planning, delegation, memory, review, and repeatable repository workflows.',
      robots: 'index,follow',
    },
  ],
  [
    '/compare/hosted-ruflo-vs-self-hosting',
    {
      title: 'Hosted Ruflo vs self-hosting from GitHub | Ruflo AI',
      description:
        'Compare hosted Ruflo with self-hosting when deciding between fast checkout, provisioning, and full infrastructure control.',
      robots: 'index,follow',
    },
  ],
  [
    '/solutions/codebase-swarms',
    {
      title: 'Run Ruflo workspaces for codebase planning and review | Ruflo AI',
      description:
        'Launch Ruflo workspaces for repository planning, execution, review, and handoff across Codex, Claude Code, and hosted UI workflows.',
      robots: 'index,follow',
    },
  ],
  [
    '/solutions/research-memory',
    {
      title: 'Use Ruflo for research loops with memory and RAG | Ruflo AI',
      description:
        'Use Ruflo AI for recurring research, source comparison, RAG-backed notes, memory, and follow-up workflows.',
      robots: 'index,follow',
    },
  ],
  [
    '/solutions/team-agent-ops',
    {
      title: 'Standardize team agent operations with Ruflo | Ruflo AI',
      description:
        'Use Ruflo AI to standardize launch, payment, provisioning, review, and workspace operations for team agent workflows.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/ruflo-ai',
    {
      title: 'Ruflo AI as a hosted multi-agent workspace | Ruflo AI',
      description:
        'Understand Ruflo AI as a hosted workspace for multi-agent orchestration, Codex, Claude Code, memory, RAG, and Goal Planner workflows.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/how-to-use-ruflo',
    {
      title: 'How to use Ruflo for the first real workflow | Ruflo AI',
      description:
        'Learn how to use Ruflo by choosing a concrete workflow, launching the default Growth yearly plan, and reviewing the first repeatable run.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/ruflo-github',
    {
      title: 'Ruflo GitHub guide for evaluating the source project | Ruflo AI',
      description:
        'Inspect the Ruflo GitHub repository for architecture, setup clarity, issue quality, plugins, memory, RAG, UI, Claude Code, and Codex fit.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/ruflo-reddit',
    {
      title: 'Ruflo Reddit research without mistaking hype for evidence | Ruflo AI',
      description:
        'Use Ruflo Reddit discussion to collect objections, setup reports, and comparisons while validating the source and a real workflow.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/ruflo-codex',
    {
      title: 'Ruflo and Codex for structured repository work | Ruflo AI',
      description:
        'Use Ruflo with Codex when repository work needs planning, agent roles, review checkpoints, and memory beyond one coding session.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/ruflo-claude-code',
    {
      title: 'Ruflo and Claude Code for agent delegation | Ruflo AI',
      description:
        'Use Ruflo with Claude Code to structure planning, implementation, review, memory, and repeatable repository workflows.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/hosted-multi-agent-workspaces',
    {
      title: 'Hosted multi-agent workspaces: when they beat isolated AI chats | Ruflo AI',
      description:
        'Learn when hosted multi-agent workspaces are useful for goals, roles, memory, review, checkout, and team workflow follow-up.',
      keywords: [
        'hosted multi-agent workspaces',
        'hosted Ruflo workspace',
        'multi-agent workspace',
        'AI agent workspace',
        'agent orchestration workspace',
      ],
      robots: 'index,follow',
    },
  ],
  [
    '/resources/multi-agent-coding-workflows',
    {
      title: 'Multi-agent coding workflows for planning, implementation, and review | Ruflo AI',
      description:
        'Structure multi-agent coding workflows with planner, worker, reviewer, and verifier roles around real repository work.',
      keywords: [
        'multi-agent coding workflows',
        'multi-agent coding',
        'AI coding workflow',
        'repository workflow',
        'agent code review',
      ],
      robots: 'index,follow',
    },
  ],
  [
    '/resources/ai-agent-memory-rag',
    {
      title: 'AI agent memory and RAG for repeatable Ruflo workflows | Ruflo AI',
      description:
        'Use AI agent memory and RAG deliberately in Ruflo workflows so repeated work keeps useful context without hiding stale sources.',
      keywords: [
        'AI agent memory',
        'RAG workflow',
        'memory and RAG',
        'agent memory',
        'Ruflo memory',
        'retrieval augmented agent workflow',
      ],
      robots: 'index,follow',
    },
  ],
  [
    '/resources/goal-planner-ui',
    {
      title: 'Goal Planner UI for agent workspaces | Ruflo AI',
      description:
        'See what a Goal Planner UI should capture before agent work starts: goals, roles, model route, review checkpoint, and workspace state.',
      keywords: [
        'Goal Planner UI',
        'agent goal planner',
        'AI workflow planner',
        'Ruflo UI',
        'workspace goal planning',
      ],
      robots: 'index,follow',
    },
  ],
  [
    '/resources/codebase-planning-review',
    {
      title: 'Codebase planning and review with Ruflo, Codex, and Claude Code | Ruflo AI',
      description:
        'Use Ruflo around codebase planning, implementation review, release checks, and repository handoff with Codex or Claude Code.',
      keywords: [
        'codebase planning',
        'repository review',
        'implementation review',
        'Codex codebase workflow',
        'Claude Code review workflow',
      ],
      robots: 'index,follow',
    },
  ],
  [
    '/resources/team-agent-operations',
    {
      title: 'Team agent operations for hosted Ruflo workspaces | Ruflo AI',
      description:
        'Turn agent experiments into team agent operations with owners, workspace capacity, review rules, billing, and support paths.',
      keywords: [
        'team agent operations',
        'agent operations',
        'AI agent ops',
        'hosted Ruflo team workflow',
        'agent workflow management',
      ],
      robots: 'index,follow',
    },
  ],
  [
    '/resources/is-ruflo-legit',
    {
      title: 'Is Ruflo legit? A practical evaluation checklist | Ruflo AI',
      description:
        'Evaluate whether Ruflo is legit by reviewing source evidence, setup clarity, workflow fit, public issues, and a small real test.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/ruflo-ui',
    {
      title: 'Ruflo UI for goal planning and workspace operations | Ruflo AI',
      description:
        'Understand what Ruflo UI should do for goal planning, checkout, provisioning, console access, and workspace review.',
      robots: 'index,follow',
    },
  ],
  [
    '/privacy',
    {
      title: 'Privacy Policy | Ruflo AI',
      description:
        'Read how Ruflo AI processes visitor, account, order, payment, provisioning, and support information.',
      robots: 'index,follow',
      canonicalPath: '/privacy/',
    },
  ],
  [
    '/terms',
    {
      title: 'Terms of Service | Ruflo AI',
      description:
        'Review the Ruflo AI Terms of Service for account, order, payment, provisioning, console, and support usage.',
      robots: 'index,follow',
      canonicalPath: '/terms/',
    },
  ],
  [
    '/console',
    {
      title: 'Console | Ruflo AI',
      description:
        'Track Ruflo AI orders, provisioning, upgrades, and account operations inside the console.',
      robots: 'noindex,nofollow',
    },
  ],
  [
    '/checkout',
    {
      title: 'Checkout | Ruflo AI',
      description:
        'Review Ruflo AI checkout details, selected plan context, hosted Creem payment handoff, support contact, and provisioning follow-up.',
      robots: 'noindex,follow',
    },
  ],
])

const seoFallbackContent = new Map([
  [
    '/pricing',
    {
      heading: 'Ruflo AI pricing and checkout options',
      intro:
        'Ruflo AI pricing uses three public monthly plan amounts and explicit monthly or yearly checkout. Starter is $19/mo, Growth is $49/mo, and Scale is $149/mo before annual discounts.',
      points: [
        'Starter fits one hosted Ruflo workspace with a Claude Code or Codex entrypoint.',
        'Growth is the common team plan with five workspaces, review flows, and reusable memory.',
        'Scale supports larger agent programs with 20 workspaces and priority launch support.',
        'Checkout states the selected billing cycle before handoff; plans do not silently auto-renew from a hidden subscription.',
      ],
    },
  ],
  [
    '/resources',
    {
      heading: 'Ruflo AI resources and evaluation guides',
      intro:
        'The Ruflo AI resource hub collects practical guides for evaluating the hosted workspace, comparing self-hosting, checking source evidence, and understanding Codex or Claude Code workflows.',
      points: [
        'Use the GitHub and legitimacy guides before treating Ruflo as a production workflow.',
        'Use the Codex and Claude Code guides when repository work needs planning, review, and memory.',
        'Use pricing, terms, privacy, llms.txt, and sitemap links when an answer engine needs stable references.',
      ],
    },
  ],
  [
    '/checkout',
    {
      heading: 'Ruflo AI checkout readiness',
      intro:
        'The checkout route explains the payment handoff without exposing a public indexable purchase page. Ruflo AI uses hosted payment sessions and returns buyers to the site for provisioning follow-up.',
      points: [
        'Public prices are Starter $19/mo, Growth $49/mo, and Scale $149/mo before annual discounts.',
        'Hosted checkout is handled through the configured payment provider; support is available at support@aigeamy.com.',
        'After payment, buyers return to the Ruflo AI site or console to continue provisioning and workspace tracking.',
        'The page keeps plan and billing context visible before a user leaves the Ruflo AI domain for payment.',
      ],
    },
  ],
  [
    '/',
    {
      heading: 'Hosted Ruflo AI workspace for multi-agent work',
      intro:
        'Ruflo AI gives teams a hosted path for coordinating agent work around Codex, Claude Code, memory, RAG, review, and checkout. Use it when the goal is a repeatable workspace instead of another isolated model chat.',
      points: [
        'Launch a workspace with model route, billing cycle, and workspace count selected up front.',
        'Use Ruflo around codebase planning, implementation review, research memory, and team agent operations.',
        'Return after checkout to continue provisioning and workspace follow-up from the same product surface.',
      ],
    },
  ],
  [
    '/plans',
    {
      heading: 'Ruflo pricing plans and hosted checkout',
      intro:
        'Choose a Ruflo AI plan with clear monthly pricing, annual billing options, and hosted Creem checkout for a managed multi-agent workspace.',
      points: [
        'Starter is $19/mo, Growth is $49/mo, and Scale is $149/mo before annual discounts.',
        'Annual checkout keeps the billing period explicit and applies 50% off yearly billing.',
        'Use Checkout and launch workspace to open hosted Creem payment, or select USDC Wallet before checkout.',
        'The selected cycle is shown in the order summary so users can tell monthly and yearly checkout apart.',
      ],
    },
  ],
  [
    '/compare/ruflo-vs-single-agent-tools',
    {
      heading: 'Ruflo compared with single-agent coding tools',
      intro:
        'Single-agent tools are strongest for focused edits. Ruflo is designed for workflows that need planning, delegation, memory, review checkpoints, and a way to turn one good run into a reusable team process.',
      points: [
        'Choose Ruflo when planner, worker, reviewer, and memory roles all matter.',
        'Stay with one agent when the task is small, local, and does not need persistent workflow memory.',
        'Use the hosted layer when evaluation, payment, launch, and follow-up need to live together.',
      ],
    },
  ],
  [
    '/compare/hosted-ruflo-vs-self-hosting',
    {
      heading: 'Hosted Ruflo versus self-hosting',
      intro:
        'Hosted Ruflo is for buyers who want a fast commercial path, managed defaults, and a working console before investing in full infrastructure ownership. Self-hosting fits teams that need maximum control from day one.',
      points: [
        'Hosted usage shortens the path from evaluation to a real workspace launch.',
        'Self-hosting gives deeper infrastructure control when the team is ready to own operations.',
        'Many teams validate the workflow hosted first, then decide whether self-hosting is worth the engineering time.',
      ],
    },
  ],
  [
    '/solutions/codebase-swarms',
    {
      heading: 'Ruflo workspaces for codebase swarms',
      intro:
        'Codebase swarms use coordinated roles around repository work: planning, implementation, review, handoff, and memory. Ruflo helps make that loop explicit enough to repeat across real engineering tasks.',
      points: [
        'Good fit for repo triage, refactor planning, pull request review, and release preparation.',
        'Works beside Codex and Claude Code when the team needs orchestration around implementation.',
        'Keeps goals, outputs, review notes, and follow-up closer than scattered chat sessions.',
      ],
    },
  ],
  [
    '/solutions/research-memory',
    {
      heading: 'Ruflo research loops with memory and RAG',
      intro:
        'Ruflo can support recurring research, source comparison, documentation, and evaluation work where the next run should benefit from what the previous run learned.',
      points: [
        'Use memory for stable decisions, source patterns, and workflow notes rather than storing everything.',
        'Pair retrieval with human review so important claims remain inspectable.',
        'Fit the workflow to repeated briefs, tool comparisons, and technical research cycles.',
      ],
    },
  ],
  [
    '/solutions/team-agent-ops',
    {
      heading: 'Team agent operations with Ruflo',
      intro:
        'Team agent ops is about making agent work buyable, reviewable, and repeatable across people, repositories, and workspaces. Ruflo gives that process a hosted service surface.',
      points: [
        'Keep launch, payment, provisioning, console access, and review in one workflow.',
        'Use Growth yearly as the common team rollout path when ongoing usage is expected.',
        'Standardize successful agent workflows so they can be reused instead of rediscovered.',
      ],
    },
  ],
  [
    '/resources/ruflo-ai',
    {
      heading: 'What Ruflo AI is',
      intro:
        'Ruflo AI is a hosted product surface for Ruflo-style agent orchestration. It packages goal planning, multi-agent delegation, memory, RAG, checkout, provisioning, and console access into a service customers can start quickly.',
      points: [
        'Use it when one model session is not enough structure for recurring work.',
        'Evaluate the public Ruflo source project and the hosted commercial path together.',
        'Start with a small workflow that proves planning, review, or memory improves the next run.',
      ],
    },
  ],
  [
    '/resources/how-to-use-ruflo',
    {
      heading: 'How to use Ruflo for the first workflow',
      intro:
        'The best first Ruflo workflow is small enough to review and important enough to repeat. Choose a concrete repository, research, or review loop before adding more integrations.',
      points: [
        'Name the goal, the expected output, and the human review step before launch.',
        'Start with one entrypoint and one model route, then expand only after the loop works.',
        'After the run, decide what should become reusable memory for the next similar task.',
      ],
    },
  ],
  [
    '/resources/ruflo-github',
    {
      heading: 'Ruflo GitHub evaluation guide',
      intro:
        'Use the Ruflo GitHub repository for technical confidence: architecture, setup clarity, issue quality, plugins, memory, RAG, UI, Claude Code, and Codex fit.',
      points: [
        'Read beyond the headline and inspect setup, examples, documentation, and recent issues.',
        'Compare what the source project provides with what the hosted product adds operationally.',
        'Use hosted Ruflo when the buyer needs a managed path to launch and follow-up.',
      ],
    },
  ],
  [
    '/resources/ruflo-reddit',
    {
      heading: 'Ruflo community research without hype',
      intro:
        'Community discussion can surface objections, setup friction, comparisons, and real user language. Treat it as input for evaluation, not as the whole decision.',
      points: [
        'Look for repeated concrete reports instead of one-off dramatic comments.',
        'Pair Reddit or community research with GitHub review and a small real workflow test.',
        'Use discussion to sharpen questions about setup, security, alternatives, and value.',
      ],
    },
  ],
  [
    '/resources/ruflo-codex',
    {
      heading: 'Ruflo and Codex for repository work',
      intro:
        'Codex is strong at implementation and codebase work. Ruflo adds structure around it when planning, review, memory, and repeated delivery matter.',
      points: [
        'Use Codex for scoped implementation, debugging, and test fixes.',
        'Use Ruflo around Codex when the workflow needs roles, acceptance criteria, and follow-up memory.',
        'Keep tests, files, review criteria, and handoff notes visible throughout the loop.',
      ],
    },
  ],
  [
    '/resources/ruflo-claude-code',
    {
      heading: 'Ruflo and Claude Code for agent delegation',
      intro:
        'Claude Code can handle hands-on repository work. Ruflo helps coordinate the surrounding goal planning, worker and reviewer roles, memory, and repeatable operating pattern.',
      points: [
        'Use Claude Code for implementation, refactoring, debugging, and exploratory codebase changes.',
        'Use Ruflo when the task benefits from multiple roles and explicit review checkpoints.',
        'Preserve useful context after the run so the next similar task starts faster.',
      ],
    },
  ],
  [
    '/resources/hosted-multi-agent-workspaces',
    {
      heading: 'Hosted multi-agent workspaces',
      intro:
        'Hosted multi-agent workspaces coordinate goals, roles, memory, review, checkout, and follow-up so teams can repeat agent work instead of scattering it across private chats.',
      points: [
        'Use hosted workspaces when a team needs a shared operating loop rather than one isolated model session.',
        'Evaluate the workflow with one repeatable task before investing in full self-hosting.',
        'Check pricing, support, privacy, terms, and checkout return paths before rollout.',
      ],
    },
  ],
  [
    '/resources/multi-agent-coding-workflows',
    {
      heading: 'Multi-agent coding workflows',
      intro:
        'A useful multi-agent coding workflow separates planning, implementation, review, verification, and memory around concrete repository work.',
      points: [
        'Start with the task shape: triage, implementation, refactor, test repair, release preparation, or pull request review.',
        'Assign planner, worker, reviewer, and verifier roles only where they reduce ambiguity.',
        'Keep tests, acceptance criteria, and human review visible throughout the loop.',
      ],
    },
  ],
  [
    '/resources/ai-agent-memory-rag',
    {
      heading: 'AI agent memory and RAG',
      intro:
        'AI agent memory preserves durable workspace context, while RAG retrieves task-specific source material. Both should make Ruflo runs easier to review.',
      points: [
        'Store stable decisions, conventions, review rules, and reusable workflow notes as memory.',
        'Use retrieval for documentation, issue threads, research briefs, and source material.',
        'Ask important outputs to show which memory or source influenced the recommendation.',
      ],
    },
  ],
  [
    '/resources/goal-planner-ui',
    {
      heading: 'Goal Planner UI for agent workspaces',
      intro:
        'A Goal Planner UI turns a broad intention into a goal, role split, model route, workspace note, review checkpoint, and next action.',
      points: [
        'Capture goal, expected artifact, model route, and review owner before launch.',
        'Keep plan selection, workspace count, payment state, and follow-up visible.',
        'Use the planner to make the first run clearer and the second run easier to repeat.',
      ],
    },
  ],
  [
    '/resources/codebase-planning-review',
    {
      heading: 'Codebase planning and review',
      intro:
        'Ruflo can coordinate codebase planning and review around Codex or Claude Code when repository work needs scope, verification, and reusable handoff notes.',
      points: [
        'Plan the target module, likely files, risk, and verification path before touching code.',
        'Use coding agents for concrete implementation, debugging, review, or repository exploration.',
        'Record what changed, what was verified, what remains risky, and what should become memory.',
      ],
    },
  ],
  [
    '/resources/team-agent-operations',
    {
      heading: 'Team agent operations',
      intro:
        'Team agent operations turn agent experiments into a service surface with owners, workspace capacity, billing, support, review rules, and reusable workflow patterns.',
      points: [
        'Name the workspace owner, review owner, billing contact, and support path before rollout.',
        'Standardize repeat workflows such as codebase review, research briefs, implementation plans, and release checklists.',
        'Measure improvement by faster repeat runs, clearer review notes, and fewer lost decisions.',
      ],
    },
  ],
  [
    '/resources/is-ruflo-legit',
    {
      heading: 'A practical Ruflo legitimacy checklist',
      intro:
        'A grounded Ruflo evaluation checks source evidence, workflow fit, setup clarity, visible tradeoffs, and a small real test. GitHub stars and broad autonomy claims are not enough by themselves.',
      points: [
        'Inspect the source repository, documentation, issues, and integration claims.',
        'Define one real workflow and review whether Ruflo improves planning, delegation, review, or memory.',
        'Buy hosted only when the commercial path solves a real operational problem for the team.',
      ],
    },
  ],
  [
    '/resources/ruflo-ui',
    {
      heading: 'Ruflo UI for workspace operations',
      intro:
        'A useful Ruflo UI makes the goal, selected model route, workspace count, billing cycle, launch state, and next action obvious without exposing unnecessary infrastructure detail.',
      points: [
        'Keep launch actions, plan selection, and checkout return paths easy to find.',
        'Show workspace status and console follow-up clearly after payment.',
        'Use the interface to reduce hesitation rather than burying buyers in configuration.',
      ],
    },
  ],
  [
    '/privacy',
    {
      heading: 'Ruflo AI privacy overview',
      intro:
        'The privacy page explains how Ruflo AI handles visitor, account, order, payment, provisioning, and support information for the hosted workspace service.',
      points: [
        'Review what information supports checkout, analytics, provisioning, and support.',
        'Use the support contact for privacy questions tied to the hosted service.',
        'Keep sensitive workspace details out of public forms unless required for support.',
      ],
    },
  ],
  [
    '/terms',
    {
      heading: 'Ruflo AI terms of service overview',
      intro:
        'The terms page explains account, order, payment, provisioning, console, and support rules for using the hosted Ruflo AI service.',
      points: [
        'Review plan, billing, workspace, and support responsibilities before purchase.',
        'Use hosted checkout only when you understand the service scope and plan limits.',
        'Keep human review in the loop for workflows involving security, payment, or customer-facing changes.',
      ],
    },
  ],
])

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

function formatMoney(amountCents, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100)
}

const { getChannelById, getModelById, resolvePlanSelection, validateCommunicationToken } = createCatalogHelpers({
  annualBillingMultiplier,
  channelCatalog,
  formatMoney,
  HttpError,
  modelCatalog,
  planCatalog,
})

function getEnv(env, key) {
  const value = env?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function firstEnv(env, ...keys) {
  for (const key of keys) {
    const value = getEnv(env, key)
    if (value) {
      return value
    }
  }

  return ''
}

async function getSecretValue(value) {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (value && typeof value.get === 'function') {
    const resolved = await value.get()
    return typeof resolved === 'string' ? resolved.trim() : ''
  }

  return ''
}

async function firstSecretEnv(env, ...keys) {
  for (const key of keys) {
    const value = await getSecretValue(env?.[key])
    if (value) {
      return value
    }
  }

  return ''
}

function getSecurityHeaders() {
  return new Headers({
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self' 'unsafe-inline' https://www.paypal.com https://www.paypalobjects.com",
      "connect-src 'self' https://api.creem.io https://test-api.creem.io https://api-m.paypal.com https://api-m.sandbox.paypal.com https://api.nowpayments.io",
      "frame-src https://www.paypal.com https://*.paypal.com",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  })
}

function getConfiguredOrigins(env) {
  return getEnv(env, 'APP_ORIGIN')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

function isTemporaryCloudflareOrigin(origin) {
  try {
    return new URL(origin).hostname.endsWith('.workers.dev')
  } catch {
    return false
  }
}

function getRequestOrigin(request, env) {
  const configuredOrigins = getConfiguredOrigins(env)
  const configuredPublicOrigin = configuredOrigins.find((origin) => !isTemporaryCloudflareOrigin(origin))
  if (configuredPublicOrigin) {
    return configuredPublicOrigin
  }

  const requestOrigin = new URL(request.url).origin
  if (requestOrigin && !isTemporaryCloudflareOrigin(requestOrigin)) {
    return requestOrigin
  }

  return defaultOrigin
}

function isAllowedOrigin(request, env, origin) {
  const normalizedOrigin = String(origin ?? '').trim().replace(/\/+$/, '')
  if (!normalizedOrigin) {
    return true
  }

  const allowedOrigins = new Set(getConfiguredOrigins(env))
  allowedOrigins.add(new URL(request.url).origin)
  return allowedOrigins.has(normalizedOrigin)
}

function getCorsHeaders(request, env) {
  const headers = getSecurityHeaders()
  const origin = request.headers.get('Origin')

  if (!origin || !isAllowedOrigin(request, env, origin)) {
    return headers
  }

  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Credentials', 'true')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, x-multica-guest-token')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Vary', 'Origin')
  return headers
}

function verifyOrigin(request, env) {
  const origin = request.headers.get('Origin')
  if (!origin || isAllowedOrigin(request, env, origin)) {
    return
  }

  throw new HttpError(403, 'Origin is not allowed.')
}

function sendJson(request, env, payload, status = 200) {
  const headers = getCorsHeaders(request, env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(payload), { status, headers })
}

function sendText(request, env, body, contentType, status = 200) {
  const headers = getCorsHeaders(request, env)
  headers.set('Content-Type', contentType)
  return new Response(body, { status, headers })
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > bodyLimitBytes) {
    throw new HttpError(413, 'Request body is too large.')
  }

  try {
    return await request.json()
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
}

async function requestJson(url, { method = 'GET', headers = {}, body } = {}) {
  const requestHeaders = new Headers(headers)
  let requestBody

  if (body instanceof URLSearchParams) {
    requestBody = body.toString()
    if (!requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/x-www-form-urlencoded')
    }
  } else if (body) {
    requestBody = JSON.stringify(body)
    if (!requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json')
    }
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, 'The payment provider rejected the configured API credentials.')
    }

    const message =
      payload?.message ??
      payload?.error ??
      payload?.error_description ??
      payload?.details?.message ??
      payload?.details?.[0]?.description ??
      `Payment request failed with status ${response.status}.`
    throw new HttpError(502, message)
  }

  return payload
}

function getCheckoutUrl(payload) {
  for (const candidate of [payload?.checkout_url, payload?.checkoutUrl, payload?.url]) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim()
    }
  }

  const links = Array.isArray(payload?.links) ? payload.links : []
  const checkoutLink = links.find((link) => {
    const rel = String(link?.rel ?? '').toLowerCase()
    return rel === 'checkout' || rel === 'payment' || rel === 'payer-action' || rel === 'approve'
  })

  return typeof checkoutLink?.href === 'string' && checkoutLink.href.trim() ? checkoutLink.href.trim() : null
}

function canUseHostedReturnUrl(origin) {
  return !origin.includes('localhost') && !origin.includes('127.0.0.1') && !origin.includes('[::1]')
}

function getPaymentProvider(env) {
  const configuredProvider = getEnv(env, 'PAYMENT_PROVIDER').toLowerCase()
  if (configuredProvider === 'creem' || configuredProvider === 'paypal') {
    return configuredProvider
  }

  return 'creem'
}

async function getCreemSettings(env) {
  const environmentSetting = firstEnv(env, 'CREEM_ENV', 'CREEM_MODE').toLowerCase()
  const testApiKey = await firstSecretEnv(env, 'API_TEST_KEY', 'CREEM_TEST_KEY', 'creem_test_key')
  const liveApiKey = await firstSecretEnv(env, 'API_PROD_KEY', 'CREEM_API_KEY', 'CREEM_KEY')
  const isTestMode =
    environmentSetting === 'test'
      ? true
      : environmentSetting === 'live' || environmentSetting === 'production'
        ? false
        : Boolean(testApiKey) && !liveApiKey
  const apiKey = isTestMode ? testApiKey : liveApiKey || testApiKey
  const baseUrl = getEnv(env, 'CREEM_BASE_URL') || (isTestMode ? 'https://test-api.creem.io' : 'https://api.creem.io')

  return { apiKey, baseUrl, isTestMode }
}

async function getPayPalSettings(env) {
  const environment = firstEnv(env, 'PAYPAL_ENV').toLowerCase()
  const isLive = environment === 'live' || environment === 'production'

  return {
    clientId: await firstSecretEnv(env, 'PAY_CLIENT_ID', 'PAYPAL_CLIENT_ID'),
    secret: await firstSecretEnv(env, 'PAY_SECRET', 'PAYPAL_CLIENT_SECRET'),
    baseUrl: getEnv(env, 'PAYPAL_BASE_URL') || (isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'),
  }
}

function buildHostedReturnUrl(request, env, provider, state, order = null) {
  const origin = getRequestOrigin(request, env)
  if (order?.id) {
    const guestTokenQuery = order.guestToken || order.guest_token ? `&guest_token=${encodeURIComponent(order.guestToken ?? order.guest_token)}` : ''
    return `${origin}/console?order=${encodeURIComponent(order.id)}${guestTokenQuery}`
  }

  return `${origin}/?checkout=${state}&provider=${provider}`
}

function randomId(byteLength = 16) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizeProductKey(value) {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getConfiguredCreemProductId(env, { planSelection, model, amountCents, currency }) {
  return (
    firstEnv(
      env,
      `CREEM_PRODUCT_ID_${normalizeProductKey(`${planSelection.plan.id}_${planSelection.billingCycle}_${model.id}`)}`,
      `CREEM_PRODUCT_ID_${normalizeProductKey(`${planSelection.plan.id}_${planSelection.billingCycle}_${amountCents}_${currency}`)}`,
      `CREEM_PRODUCT_ID_${normalizeProductKey(planSelection.plan.id)}`,
      'CREEM_PRODUCT_ID',
    ) || null
  )
}

async function createCreemCheckout({ env, order, planSelection, model, channel, request, stateless = true }) {
  const { apiKey, baseUrl, isTestMode } = await getCreemSettings(env)
  if (!apiKey) {
    throw new HttpError(503, 'Creem payment is not configured for this Cloudflare deployment.')
  }

  const cacheKey = `${isTestMode ? 'test' : 'live'}:${planSelection.planId}:${model.id}:${order.amountCents}:${order.currency}`
  let productId =
    getConfiguredCreemProductId(env, {
      planSelection,
      model,
      amountCents: order.amountCents,
      currency: order.currency,
    }) ?? creemProductCache.get(cacheKey)

  const origin = getRequestOrigin(request, env)
  const headers = { 'x-api-key': apiKey }

  if (!productId) {
    const product = await requestJson(`${baseUrl}/v1/products`, {
      method: 'POST',
      headers,
      body: {
        name: `Ruflo AI ${planSelection.plan.name} ${planSelection.billingCycle === 'annual' ? 'Annual' : 'Monthly'}`,
        description: `${planSelection.plan.subtitle} - ${order.amountLabel}`,
        price: order.amountCents,
        currency: order.currency,
        billing_type: 'onetime',
        tax_mode: 'inclusive',
        tax_category: 'saas',
        ...(canUseHostedReturnUrl(origin)
          ? {
              default_success_url: buildHostedReturnUrl(request, env, 'creem', 'success', stateless ? null : order),
            }
          : {}),
      },
    })
    productId = product.id
    if (!productId) {
      throw new HttpError(502, 'Creem product did not return an id.')
    }
    creemProductCache.set(cacheKey, productId)
  }

  const checkout = await requestJson(`${baseUrl}/v1/checkouts`, {
    method: 'POST',
    headers,
    body: {
      product_id: productId,
      request_id: order.id,
      success_url: buildHostedReturnUrl(request, env, 'creem', 'success', stateless ? null : order),
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        planId: planSelection.planId,
        modelId: model.id,
        channelId: channel.id,
        stateless,
      },
    },
  })

  const checkoutUrl = getCheckoutUrl(checkout)
  if (!checkoutUrl) {
    throw new HttpError(502, 'Creem checkout did not return a hosted checkout URL.')
  }

  return { checkoutUrl, checkoutId: checkout.id ?? checkout.checkout_id ?? checkout.checkoutId ?? null }
}

async function createPayPalCheckout({ env, order, planSelection, request, stateless = true }) {
  const { clientId, secret, baseUrl } = await getPayPalSettings(env)
  if (!clientId || !secret) {
    throw new HttpError(503, 'PayPal payment is not configured for this Cloudflare deployment.')
  }

  const accessTokenPayload = await requestJson(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })

  const checkout = await requestJson(`${baseUrl}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessTokenPayload.access_token}`,
    },
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: order.id,
          custom_id: order.id,
          description: `Ruflo AI ${planSelection.plan.name} ${planSelection.billingCycle === 'annual' ? 'Yearly' : 'Monthly'}`,
          amount: {
            currency_code: order.currency,
            value: (order.amountCents / 100).toFixed(2),
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Ruflo AI',
            landing_page: 'LOGIN',
            user_action: 'PAY_NOW',
            return_url: buildHostedReturnUrl(request, env, 'paypal', 'success', stateless ? null : order),
            cancel_url: buildHostedReturnUrl(request, env, 'paypal', 'cancelled', stateless ? null : order),
          },
        },
      },
    },
  })

  const checkoutUrl = getCheckoutUrl(checkout)
  if (!checkoutUrl) {
    throw new HttpError(502, 'PayPal checkout did not return a hosted checkout URL.')
  }

  return { checkoutUrl, paypalOrderId: checkout.id ?? null }
}

function serializePlan(plan) {
  const annualAmountCents = Math.round(plan.monthlyAmountCents * 12 * annualBillingMultiplier)

  return {
    ...plan,
    annualAmountCents,
    annualPriceLabel: formatMoney(annualAmountCents, plan.currency),
  }
}

async function createStatelessCheckout(body, request, env) {
  const model = getModelById(String(body.modelId ?? 'gpt-5-5'))
  const planSelection = resolvePlanSelection(String(body.planId ?? 'growth:annual'), { model })
  const channel = getChannelById(String(body.channelId ?? 'telegram'))
  validateCommunicationToken(channel.id, String(body.communicationToken ?? '').trim())

  const order = {
    id: randomId(16),
    orderNumber: `mca-${Date.now().toString().slice(-8)}`,
    amountCents: planSelection.amountCents,
    amountLabel: formatMoney(planSelection.amountCents, planSelection.plan.currency),
    currency: planSelection.plan.currency,
  }

  const paymentProvider = getPaymentProvider(env)
  const checkout =
    paymentProvider === 'creem'
      ? await createCreemCheckout({ env, order, planSelection, model, channel, request })
      : await createPayPalCheckout({ env, order, planSelection, request })

  return {
    message: 'Checkout is ready.',
    orderId: order.id,
    orderNumber: order.orderNumber,
    planId: planSelection.planId,
    modelId: model.id,
    channelId: channel.id,
    amountCents: order.amountCents,
    amountLabel: order.amountLabel,
    currency: order.currency,
    checkoutUrl: checkout.checkoutUrl,
    paymentProvider,
    creemCheckoutId: checkout.checkoutId ?? null,
    paypalOrderId: checkout.paypalOrderId ?? null,
    paypalClientId: paymentProvider === 'paypal' ? (await firstSecretEnv(env, 'PAY_CLIENT_ID', 'PAYPAL_CLIENT_ID')) || null : null,
    stateless: true,
  }
}

function hasD1Database(env) {
  return Boolean(env?.DB && typeof env.DB.prepare === 'function')
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeBindParams(params) {
  return params.map((value) => (value === undefined ? null : value))
}

function d1Statement(env, sql) {
  const database = env.DB
  return {
    async get(...params) {
      return (await database.prepare(sql).bind(...normalizeBindParams(params)).first()) ?? null
    },
    async all(...params) {
      const result = await database.prepare(sql).bind(...normalizeBindParams(params)).all()
      return result.results ?? []
    },
    async run(...params) {
      const result = await database.prepare(sql).bind(...normalizeBindParams(params)).run()
      return {
        changes: Number(result.meta?.changes ?? result.changes ?? 0),
      }
    },
  }
}

function parseCookies(request) {
  const cookies = {}
  const rawCookie = request.headers.get('Cookie') ?? ''

  rawCookie.split(';').forEach((item) => {
    const [key, ...value] = item.trim().split('=')
    if (!key) {
      return
    }

    cookies[key] = decodeURIComponent(value.join('='))
  })

  return cookies
}

function getGuestToken(request) {
  const cookies = parseCookies(request)
  const cookieToken = cookies[guestCookieName]
  if (cookieToken) {
    return cookieToken
  }

  const headerToken = request.headers.get('x-multica-guest-token')
  if (headerToken?.trim()) {
    return headerToken.trim()
  }

  const url = new URL(request.url)
  const queryToken = url.searchParams.get('guest_token')
  return queryToken?.trim() || null
}

function getCookieSecuritySuffix(request) {
  return new URL(request.url).protocol === 'https:' ? '; Secure' : ''
}

function buildCookie(name, value, request, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${getCookieSecuritySuffix(request)}`
}

function clearCookie(name, request) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${getCookieSecuritySuffix(request)}`
}

function appendCookies(response, cookies) {
  for (const cookie of cookies.filter(Boolean)) {
    response.headers.append('Set-Cookie', cookie)
  }

  return response
}

function textToBytes(value) {
  return new TextEncoder().encode(value)
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

async function sha256Hex(value) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', textToBytes(value)))
}

async function hashPassword(password) {
  const salt = randomId(16)
  const iterations = 100_000
  const key = await crypto.subtle.importKey('raw', textToBytes(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(salt),
      iterations,
    },
    key,
    256,
  )
  return `pbkdf2-sha256:${iterations}:${salt}:${bytesToHex(bits)}`
}

async function verifyPassword(password, storedHash) {
  const [scheme, iterationText, salt, expectedHash] = String(storedHash ?? '').split(':')
  const iterations = Number.parseInt(iterationText, 10)
  if (scheme !== 'pbkdf2-sha256' || !Number.isFinite(iterations) || !salt || !expectedHash) {
    return false
  }

  const key = await crypto.subtle.importKey('raw', textToBytes(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(salt),
      iterations,
    },
    key,
    256,
  )
  return bytesToHex(bits) === expectedHash
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function sanitizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validatePasswordInput(password) {
  const value = String(password ?? '').trim()
  if (value.length < 12 || value.length > 128) {
    throw new HttpError(400, 'Password must be between 12 and 128 characters.')
  }

  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    throw new HttpError(400, 'Password must include uppercase, lowercase, and numeric characters.')
  }
}

function validateNameInput(name) {
  if (name.length < 2 || name.length > 80) {
    throw new HttpError(400, 'Name must be between 2 and 80 characters.')
  }
}

function serializeUser(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  }
}

function getConfiguredAdminEmails(env) {
  return firstEnv(env, 'ADMIN_ALLOWED_EMAILS', 'GENERICAGENT_ADMIN_EMAILS')
    .split(/[,\s]+/)
    .map((item) => normalizeEmail(item))
    .filter(Boolean)
}

async function resolveNewUserRole(env, email, requestedRole = 'operator') {
  const configuredAdminEmails = getConfiguredAdminEmails(env)
  if (configuredAdminEmails.includes(email)) {
    return 'admin'
  }

  if (configuredAdminEmails.length > 0) {
    return requestedRole === 'admin' ? 'admin' : 'operator'
  }

  const activeUsers = await d1Statement(
    env,
    `SELECT COUNT(*) AS count FROM users WHERE email != ? AND status = 'active'`,
  ).get(guestUserEmail)
  if (Number(activeUsers?.count ?? 0) === 0) {
    return 'admin'
  }

  return requestedRole === 'admin' ? 'admin' : 'operator'
}

async function ensureGuestUser(env) {
  const existing = await d1Statement(env, `SELECT * FROM users WHERE email = ?`).get(guestUserEmail)
  if (existing) {
    return existing
  }

  const timestamp = nowIso()
  await d1Statement(
    env,
    `INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run('guest-user', guestUserEmail, 'Guest checkout', 'disabled', 'operator', 'disabled', timestamp, timestamp)
  return await d1Statement(env, `SELECT * FROM users WHERE email = ?`).get(guestUserEmail)
}

async function createSessionForUser(env, userId) {
  const token = randomId(32)
  const timestamp = nowIso()
  const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000).toISOString()
  await d1Statement(
    env,
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomId(16), userId, await sha256Hex(token), timestamp, timestamp, expiresAt)
  return token
}

async function getAuthenticatedContext(request, env) {
  if (!hasD1Database(env)) {
    return null
  }

  const token = parseCookies(request)[sessionCookieName]
  if (!token) {
    return null
  }

  const tokenHash = await sha256Hex(token)
  const session = await d1Statement(
    env,
    `SELECT
       sessions.id AS session_id,
       sessions.user_id,
       sessions.expires_at,
       users.id,
       users.email,
       users.name,
       users.role,
       users.status,
       users.created_at,
       users.updated_at,
       users.last_login_at
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`,
  ).get(tokenHash)

  if (!session) {
    return null
  }

  if (Date.parse(session.expires_at) <= Date.now()) {
    await d1Statement(env, `DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash)
    return null
  }

  if (session.status !== 'active') {
    await d1Statement(env, `DELETE FROM sessions WHERE user_id = ?`).run(session.user_id)
    return null
  }

  await d1Statement(env, `UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(nowIso(), session.session_id)
  return {
    kind: 'user',
    user: serializeUser(session),
    token,
  }
}

async function getAccessContext(request, env) {
  const authContext = await getAuthenticatedContext(request, env)
  const guestToken = getGuestToken(request)
  if (authContext) {
    return {
      ...authContext,
      guestToken,
    }
  }

  return guestToken ? { kind: 'guest', guestToken } : null
}

async function requireOrderAccessContext(request, env) {
  const context = await getAccessContext(request, env)
  if (!context) {
    throw new HttpError(401, 'Authentication or guest access required.')
  }
  return context
}

async function requireAuthenticatedUser(request, env) {
  const context = await getAuthenticatedContext(request, env)
  if (!context) {
    throw new HttpError(401, 'Authentication required.')
  }
  return context
}

async function requireAdminUser(request, env) {
  const context = await requireAuthenticatedUser(request, env)
  if (context.user.role !== 'admin') {
    throw new HttpError(403, 'Admin access required.')
  }
  return context
}

async function assertD1OrderAccess(context, order) {
  if (!order) {
    throw new HttpError(404, 'Order not found.')
  }

  if (context.kind === 'guest') {
    if (order.guest_token !== context.guestToken) {
      throw new HttpError(403, 'Order access denied.')
    }
    return
  }

  if (
    context.user.role !== 'admin' &&
    order.user_id !== context.user.id &&
    (!context.guestToken || order.guest_token !== context.guestToken)
  ) {
    throw new HttpError(403, 'Order access denied.')
  }
}

function maskCommunicationToken(token) {
  const value = String(token ?? '').trim()
  if (!value) {
    return 'No token provided'
  }

  return `${value.slice(0, 4)}****`
}

function getOrderIncludedDeployments(row) {
  const configured = Number(row?.included_deployments)
  if (Number.isFinite(configured) && configured > 0) {
    return configured
  }

  const planId = String(row?.plan_id ?? '')
  if (planId.startsWith('scale:')) {
    return 20
  }

  if (planId.startsWith('growth:')) {
    return 5
  }

  return 1
}

async function getReservedDeploymentCount(env, orderId) {
  const row = await d1Statement(
    env,
    `SELECT COUNT(*) AS count
     FROM deployments
     WHERE order_id = ?
       AND status IN ('queued', 'provisioning', 'deployed')`,
  ).get(orderId)
  return Number(row?.count ?? 0)
}

function serializeDeployment(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    instanceName: row.instance_name,
    status: row.status,
    triggerMode: row.trigger_mode,
    sequenceNumber: row.sequence_number,
    progress: row.progress,
    etaMinutes: row.eta_minutes,
    targetServer: row.target_server,
    workspacePath: row.workspace_path,
    consoleUrl: row.console_url,
    publicEndpoint: row.public_endpoint,
    runtimeUser: row.runtime_user,
    serviceName: row.service_name,
    lastMessage: row.last_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  }
}

function serializeAgentInstance(row) {
  if (!row) {
    return null
  }

  const model = getModelById(row.model_id)
  const channel = getChannelById(row.channel_id)
  return {
    id: row.id,
    orderId: row.order_id,
    deploymentId: row.deployment_id,
    sequenceNumber: row.sequence_number,
    instanceName: row.instance_name,
    modelId: row.model_id,
    modelName: model.name,
    channelId: row.channel_id,
    channelName: channel.name,
    status: row.status,
    targetServer: row.target_server,
    workspacePath: row.workspace_path,
    consoleUrl: row.console_url,
    publicEndpoint: row.public_endpoint,
    runtimeUser: row.runtime_user,
    serviceName: row.service_name,
    runtimeState: row.runtime_state ?? (row.status === 'running' ? 'running' : null),
    multicaVersion: row.multica_version ?? 'not-deployed',
    upgradeStatus: row.upgrade_status ?? 'idle',
    upgradeTargetVersion: row.upgrade_target_version,
    upgradeError: row.upgrade_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function serializeOrder(env, row, viewerContext = null) {
  const planSelection = resolvePlanSelection(row.plan_id, { modelId: row.model_id })
  const plan = planSelection.plan
  const model = getModelById(row.model_id)
  const channel = getChannelById(row.channel_id)
  const deployments = (
    await d1Statement(
      env,
      `SELECT * FROM deployments WHERE order_id = ? ORDER BY sequence_number DESC, created_at DESC`,
    ).all(row.id)
  ).map(serializeDeployment)
  const deployment = deployments[0] ?? null
  const instance = serializeAgentInstance(
    await d1Statement(
      env,
      `SELECT * FROM agent_instances WHERE order_id = ? ORDER BY sequence_number DESC, created_at DESC LIMIT 1`,
    ).get(row.id),
  )
  const includedDeployments = getOrderIncludedDeployments(row)
  const reservedDeployments = await getReservedDeploymentCount(env, row.id)
  const guestTokenQuery = row.guest_token ? `&guest_token=${encodeURIComponent(row.guest_token)}` : ''
  const deploymentStatus = deployment?.status ?? row.deployment_status
  const statusMessage = deployment?.lastMessage ?? row.status_message

  return {
    id: row.id,
    orderNumber: row.order_number,
    planId: row.plan_id,
    planName: `${plan.name} - ${planSelection.billingCycle === 'annual' ? 'Yearly' : 'Monthly'}`,
    amountCents: row.amount_cents,
    amountLabel: formatMoney(row.amount_cents, row.currency),
    currency: row.currency,
    modelId: row.model_id,
    modelName: model.name,
    channelId: row.channel_id,
    channelName: channel.name,
    paymentStatus: row.payment_status,
    deploymentStatus,
    statusMessage,
    deploymentEtaMinutes: row.deployment_eta_minutes,
    includedDeployments,
    deploymentsUsed: reservedDeployments,
    deploymentsRemaining: Math.max(includedDeployments - reservedDeployments, 0),
    canTriggerDeployment: row.payment_status === 'paid' && reservedDeployments < includedDeployments,
    bindingStatus: row.guest_token ? 'unbound' : 'bound',
    tokenDisplay: row.token_display ?? 'Token unavailable',
    canAdminDeleteMultica: viewerContext?.kind === 'user' && viewerContext.user?.role === 'admin' && Boolean(instance),
    multicaVersion: instance?.multicaVersion ?? 'not-deployed',
    upgradeStatus: instance?.upgradeStatus ?? 'idle',
    upgradeTargetVersion: instance?.upgradeTargetVersion ?? null,
    upgradeError: instance?.upgradeError ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at,
    checkoutPath: `/plans?order=${row.id}${guestTokenQuery}`,
    consolePath: `/console?order=${row.id}${guestTokenQuery}`,
    deployment,
    deployments,
    instance,
  }
}

function createPaymentOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    amountCents: row.amount_cents,
    amountLabel: formatMoney(row.amount_cents, row.currency),
    currency: row.currency,
    guestToken: row.guest_token,
  }
}

async function createCheckoutSessionForD1Order(env, request, order, viewerContext = null) {
  if (order.payment_status === 'paid') {
    return {
      message: 'This order has already been paid.',
      order: await serializeOrder(env, order, viewerContext),
      checkoutUrl: null,
      paymentProvider: getPaymentProvider(env),
      creemCheckoutId: order.creem_checkout_id ?? null,
      paypalOrderId: order.paypal_order_id ?? null,
      paypalClientId: null,
    }
  }

  const model = getModelById(order.model_id)
  const planSelection = resolvePlanSelection(order.plan_id, { model })
  const channel = getChannelById(order.channel_id)
  const paymentProvider = getPaymentProvider(env)
  const paymentOrder = createPaymentOrder(order)

  if (paymentProvider === 'creem') {
    const checkout = await createCreemCheckout({
      env,
      order: paymentOrder,
      planSelection,
      model,
      channel,
      request,
      stateless: false,
    })
    let orderWithCheckout = order
    if (checkout.checkoutId) {
      await d1Statement(env, `UPDATE orders SET creem_checkout_id = ?, updated_at = ? WHERE id = ?`).run(
        checkout.checkoutId,
        nowIso(),
        order.id,
      )
      orderWithCheckout = await d1Statement(env, `SELECT * FROM orders WHERE id = ?`).get(order.id)
    }

    return {
      message: 'Creem checkout is ready.',
      order: await serializeOrder(env, orderWithCheckout, viewerContext),
      checkoutUrl: checkout.checkoutUrl,
      paymentProvider: 'creem',
      creemCheckoutId: checkout.checkoutId ?? null,
      paypalOrderId: null,
      paypalClientId: null,
    }
  }

  const checkout = await createPayPalCheckout({
    env,
    order: paymentOrder,
    planSelection,
    request,
    stateless: false,
  })
  let orderWithCheckout = order
  if (checkout.paypalOrderId) {
    await d1Statement(env, `UPDATE orders SET paypal_order_id = ?, updated_at = ? WHERE id = ?`).run(
      checkout.paypalOrderId,
      nowIso(),
      order.id,
    )
    orderWithCheckout = await d1Statement(env, `SELECT * FROM orders WHERE id = ?`).get(order.id)
  }

  return {
    message: 'PayPal checkout is ready.',
    order: await serializeOrder(env, orderWithCheckout, viewerContext),
    checkoutUrl: checkout.checkoutUrl,
    paymentProvider: 'paypal',
    creemCheckoutId: null,
    paypalOrderId: checkout.paypalOrderId ?? null,
    paypalClientId: (await firstSecretEnv(env, 'PAY_CLIENT_ID', 'PAYPAL_CLIENT_ID')) || null,
  }
}

function buildOrderNumber() {
  return `mca-${Date.now().toString().slice(-8)}-${randomId(2)}`
}

async function createD1LaunchCheckout(body, request, env) {
  const authContext = await getAuthenticatedContext(request, env)
  const model = getModelById(String(body.modelId ?? 'gpt-5-5'))
  const planSelection = resolvePlanSelection(String(body.planId ?? 'growth:annual'), { model })
  const channel = getChannelById(String(body.channelId ?? 'telegram'))
  const communicationToken = String(body.communicationToken ?? '').trim()
  validateCommunicationToken(channel.id, communicationToken)

  const guestToken = authContext ? null : getGuestToken(request) ?? randomId(18)
  const ownerUser = authContext?.user ?? (await ensureGuestUser(env))
  const timestamp = nowIso()
  const orderId = randomId(16)

  await d1Statement(
    env,
    `INSERT INTO orders (
       id, order_number, user_id, guest_token, plan_id, model_id, channel_id,
       token_cipher_text, token_iv, token_tag, token_display,
       amount_cents, currency, payment_status, deployment_status, status_message,
       deployment_eta_minutes, included_deployments, created_at, updated_at,
       creem_checkout_id, paypal_order_id, paid_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
  ).run(
    orderId,
    buildOrderNumber(),
    ownerUser.id,
    guestToken,
    planSelection.planId,
    model.id,
    channel.id,
    'worker:not-stored',
    '',
    '',
    maskCommunicationToken(communicationToken),
    planSelection.amountCents,
    planSelection.plan.currency,
    'pending',
    'awaiting_payment',
    'Awaiting payment confirmation before deployment starts.',
    planSelection.plan.etaMinutes,
    planSelection.plan.includedDeployments,
    timestamp,
    timestamp,
  )

  const order = await d1Statement(env, `SELECT * FROM orders WHERE id = ?`).get(orderId)
  const checkout = await createCheckoutSessionForD1Order(
    env,
    request,
    order,
    authContext ?? (guestToken ? { kind: 'guest', guestToken } : null),
  )
  return {
    payload: {
      message: checkout.message,
      orderId: checkout.order.id,
      orderNumber: checkout.order.orderNumber,
      planId: checkout.order.planId,
      modelId: checkout.order.modelId,
      channelId: checkout.order.channelId,
      amountCents: checkout.order.amountCents,
      amountLabel: checkout.order.amountLabel,
      currency: checkout.order.currency,
      checkoutUrl: checkout.checkoutUrl,
      paymentProvider: checkout.paymentProvider,
      creemCheckoutId: checkout.creemCheckoutId ?? null,
      paypalOrderId: checkout.paypalOrderId ?? null,
      paypalClientId: checkout.paypalClientId ?? null,
      stateless: false,
      order: checkout.order,
    },
    guestToken,
  }
}

async function listVisibleOrders(env, context) {
  const rows =
    context.kind === 'guest'
      ? await d1Statement(env, `SELECT * FROM orders WHERE guest_token = ? ORDER BY created_at DESC`).all(
          context.guestToken,
        )
      : context.user.role === 'admin'
        ? await d1Statement(env, `SELECT * FROM orders ORDER BY created_at DESC`).all()
        : [
            ...(await d1Statement(env, `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`).all(
              context.user.id,
            )),
            ...(context.guestToken
              ? await d1Statement(env, `SELECT * FROM orders WHERE guest_token = ? ORDER BY created_at DESC`).all(
                  context.guestToken,
                )
              : []),
          ]

  const dedupedRows = Array.from(new Map(rows.map((row) => [row.id, row])).values())
  return await Promise.all(dedupedRows.map((row) => serializeOrder(env, row, context)))
}

async function listVisibleAgentInstances(env, context) {
  const rows =
    context.kind === 'guest'
      ? await d1Statement(
          env,
          `SELECT agent_instances.*
           FROM agent_instances
           INNER JOIN orders ON orders.id = agent_instances.order_id
           WHERE orders.guest_token = ?
           ORDER BY agent_instances.created_at DESC`,
        ).all(context.guestToken)
      : context.user.role === 'admin'
        ? await d1Statement(env, `SELECT * FROM agent_instances ORDER BY created_at DESC`).all()
        : [
            ...(await d1Statement(env, `SELECT * FROM agent_instances WHERE user_id = ? ORDER BY created_at DESC`).all(
              context.user.id,
            )),
            ...(context.guestToken
              ? await d1Statement(
                  env,
                  `SELECT agent_instances.*
                   FROM agent_instances
                   INNER JOIN orders ON orders.id = agent_instances.order_id
                   WHERE orders.guest_token = ?
                   ORDER BY agent_instances.created_at DESC`,
                ).all(context.guestToken)
              : []),
          ]

  return Array.from(new Map(rows.map((row) => [row.id, row])).values()).map(serializeAgentInstance)
}

const analyticsSql = {
  createSession: `INSERT INTO analytics_sessions (
    id, visitor_id, user_id, landing_path, referrer_host, utm_source, utm_medium, utm_campaign,
    utm_term, utm_content, device_type, browser_language, event_count, click_count,
    section_view_count, page_view_count, last_event_name, last_route_path, last_stage,
    started_at, last_seen_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  updateSession: `UPDATE analytics_sessions
    SET visitor_id = ?,
      user_id = COALESCE(?, user_id),
      referrer_host = COALESCE(referrer_host, ?),
      utm_source = COALESCE(utm_source, ?),
      utm_medium = COALESCE(utm_medium, ?),
      utm_campaign = COALESCE(utm_campaign, ?),
      utm_term = COALESCE(utm_term, ?),
      utm_content = COALESCE(utm_content, ?),
      device_type = COALESCE(device_type, ?),
      browser_language = COALESCE(browser_language, ?),
      event_count = event_count + ?,
      click_count = click_count + ?,
      section_view_count = section_view_count + ?,
      page_view_count = page_view_count + ?,
      last_event_name = ?,
      last_route_path = ?,
      last_stage = ?,
      started_at = CASE WHEN started_at < ? THEN started_at ELSE ? END,
      last_seen_at = ?,
      updated_at = ?
    WHERE id = ?`,
  createEvent: `INSERT INTO analytics_events (
    id, visitor_id, session_id, user_id, order_id, event_type, event_name, route_path,
    page_key, section_key, element_key, referrer_host, metadata_json, occurred_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING`,
}

function createWorkerAnalyticsHelpers(env) {
  return createAnalyticsHelpers({
    analyticsRateLimiter: null,
    assertOrderAccess: (context, order) => assertD1OrderAccess(context, order),
    countAnalyticsSessionsSinceStatement: d1Statement(
      env,
      `SELECT COUNT(*) AS count FROM analytics_sessions WHERE started_at >= ?`,
    ),
    countDistinctAnalyticsSessionsByEventNameSinceStatement: d1Statement(
      env,
      `SELECT COUNT(DISTINCT session_id) AS count FROM analytics_events WHERE occurred_at >= ? AND event_name = ?`,
    ),
    countDistinctAnalyticsSessionsByPagePathSinceStatement: d1Statement(
      env,
      `SELECT COUNT(DISTINCT session_id) AS count
       FROM analytics_events
       WHERE occurred_at >= ? AND event_name = 'page_view' AND route_path = ?`,
    ),
    countDistinctAnalyticsSessionsBySectionSinceStatement: d1Statement(
      env,
      `SELECT COUNT(DISTINCT session_id) AS count
       FROM analytics_events
       WHERE occurred_at >= ? AND event_name = 'content_view' AND section_key = ?`,
    ),
    countDistinctAnalyticsVisitorsSinceStatement: d1Statement(
      env,
      `SELECT COUNT(DISTINCT visitor_id) AS count FROM analytics_sessions WHERE started_at >= ?`,
    ),
    createAnalyticsSessionStatement: d1Statement(env, analyticsSql.createSession),
    createAnalyticsEventStatement: d1Statement(env, analyticsSql.createEvent),
    enforceRateLimit: () => {},
    findAnalyticsSessionByIdStatement: d1Statement(env, `SELECT * FROM analytics_sessions WHERE id = ?`),
    findOrderByIdStatement: d1Statement(env, `SELECT * FROM orders WHERE id = ?`),
    getAuthenticatedContext: (request) => getAuthenticatedContext(request, env),
    getGuestToken,
    listAnalyticsDropOffStagesSinceStatement: d1Statement(
      env,
      `SELECT COALESCE(last_stage, 'unknown') AS stage, COUNT(*) AS count
       FROM analytics_sessions
       WHERE started_at >= ? AND COALESCE(last_stage, 'unknown') != 'payment_completed'
       GROUP BY COALESCE(last_stage, 'unknown')
       ORDER BY count DESC, stage ASC
       LIMIT ?`,
    ),
    listAnalyticsEventsBySessionIdStatement: d1Statement(
      env,
      `SELECT * FROM analytics_events WHERE session_id = ? ORDER BY occurred_at ASC, created_at ASC`,
    ),
    listAnalyticsSessionsSinceStatement: d1Statement(
      env,
      `SELECT * FROM analytics_sessions WHERE started_at >= ? ORDER BY last_seen_at DESC LIMIT ?`,
    ),
    listAnalyticsTopCtaClicksSinceStatement: d1Statement(
      env,
      `SELECT COALESCE(element_key, 'unknown') AS key,
        COALESCE(section_key, 'unknown') AS section,
        COUNT(*) AS clicks,
        COUNT(DISTINCT session_id) AS sessions
       FROM analytics_events
       WHERE occurred_at >= ? AND event_type = 'click' AND event_name = 'cta_click'
       GROUP BY COALESCE(element_key, 'unknown'), COALESCE(section_key, 'unknown')
       ORDER BY clicks DESC, sessions DESC, key ASC
       LIMIT ?`,
    ),
    listAnalyticsTopReferrersSinceStatement: d1Statement(
      env,
      `SELECT COALESCE(referrer_host, '(direct)') AS host, COUNT(*) AS count
       FROM analytics_sessions
       WHERE started_at >= ?
       GROUP BY COALESCE(referrer_host, '(direct)')
       ORDER BY count DESC, host ASC
       LIMIT ?`,
    ),
    nowIso,
    readJsonBody,
    requireAdminUser: (request) => requireAdminUser(request, env),
    sumAnalyticsSessionMetricsSinceStatement: d1Statement(
      env,
      `SELECT COALESCE(SUM(page_view_count), 0) AS page_views,
        COALESCE(SUM(section_view_count), 0) AS section_views,
        COALESCE(SUM(click_count), 0) AS clicks
       FROM analytics_sessions
       WHERE started_at >= ?`,
    ),
    updateAnalyticsSessionStatement: d1Statement(env, analyticsSql.updateSession),
  })
}

async function createUserRecord(env, { email, name, password, role = 'operator' }) {
  const normalizedEmail = normalizeEmail(email)
  const normalizedName = sanitizeName(name)
  validateNameInput(normalizedName)
  validatePasswordInput(password)
  if (!validateEmail(normalizedEmail)) {
    throw new HttpError(400, 'Enter a valid email address.')
  }

  if (await d1Statement(env, `SELECT id FROM users WHERE email = ?`).get(normalizedEmail)) {
    throw new HttpError(409, 'An account with this email already exists.')
  }

  const timestamp = nowIso()
  const userId = randomId(16)
  const resolvedRole = await resolveNewUserRole(env, normalizedEmail, role)
  await d1Statement(
    env,
    `INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(userId, normalizedEmail, normalizedName, await hashPassword(password), resolvedRole, 'active', timestamp, timestamp)
  return await d1Statement(env, `SELECT * FROM users WHERE id = ?`).get(userId)
}

async function markD1OrderPaid(env, order) {
  if (order.payment_status === 'paid') {
    return order
  }

  const timestamp = nowIso()
  await d1Statement(
    env,
    `UPDATE orders
     SET payment_status = 'paid',
       deployment_status = 'queued',
       status_message = 'Payment confirmed. Manual provisioning queue is ready.',
       paid_at = ?,
       updated_at = ?
     WHERE id = ?`,
  ).run(timestamp, timestamp, order.id)

  const existingDeployment = await d1Statement(env, `SELECT id FROM deployments WHERE order_id = ? LIMIT 1`).get(order.id)
  if (!existingDeployment) {
    await d1Statement(
      env,
      `INSERT INTO deployments (
        id, order_id, user_id, trigger_mode, sequence_number, instance_name, status, progress,
        eta_minutes, target_server, workspace_path, console_url, public_endpoint, runtime_user,
        service_name, console_token_cipher_text, console_token_iv, console_token_tag,
        last_message, run_logs, created_at, started_at, finished_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL, ?)`,
    ).run(
      randomId(16),
      order.id,
      order.user_id,
      'manual',
      1,
      `ruflo-${order.order_number.toLowerCase()}`,
      'queued',
      10,
      order.deployment_eta_minutes,
      'cloudflare-manual',
      'Payment confirmed. Waiting for manual provisioning.',
      '',
      timestamp,
      timestamp,
    )
  }

  return await d1Statement(env, `SELECT * FROM orders WHERE id = ?`).get(order.id)
}

async function getCreemCheckoutSession(env, checkoutId) {
  const { apiKey, baseUrl } = await getCreemSettings(env)
  if (!apiKey) {
    throw new HttpError(503, 'Creem payment is not configured for this Cloudflare deployment.')
  }

  return await requestJson(`${baseUrl}/v1/checkouts?checkout_id=${encodeURIComponent(checkoutId)}`, {
    headers: { 'x-api-key': apiKey },
  })
}

function hasCompletedPayPalCapture(payload) {
  const captures = Array.isArray(payload?.purchase_units)
    ? payload.purchase_units.flatMap((unit) => unit?.payments?.captures ?? [])
    : []
  return captures.some((capture) => String(capture?.status ?? '').toUpperCase() === 'COMPLETED')
}

async function capturePayPalOrder(env, order, payPalOrderId) {
  const normalizedOrderId = String(payPalOrderId ?? '').trim()
  if (!normalizedOrderId) {
    throw new HttpError(400, 'PayPal order ID is required.')
  }

  if (order.paypal_order_id && order.paypal_order_id !== normalizedOrderId) {
    throw new HttpError(400, 'PayPal order ID does not match this checkout.')
  }

  const { clientId, secret, baseUrl } = await getPayPalSettings(env)
  if (!clientId || !secret) {
    throw new HttpError(503, 'PayPal payment is not configured for this Cloudflare deployment.')
  }

  const accessTokenPayload = await requestJson(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })
  const capture = await requestJson(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessTokenPayload.access_token}`,
    },
    body: {},
  })

  if (String(capture?.status ?? '').toUpperCase() !== 'COMPLETED' && !hasCompletedPayPalCapture(capture)) {
    throw new HttpError(400, 'PayPal payment has not been completed yet.')
  }

  return await markD1OrderPaid(env, order)
}

async function handleD1ApiRequest(request, env) {
  const url = new URL(request.url)

  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const context = await getAuthenticatedContext(request, env)
    return sendJson(request, env, { user: context?.user ?? null })
  }

  if (url.pathname === '/api/auth/register' && request.method === 'POST') {
    const body = await readJsonBody(request)
    const user = await createUserRecord(env, {
      email: body.email,
      name: body.name,
      password: body.password,
    })
    const token = await createSessionForUser(env, user.id)
    const timestamp = nowIso()
    await d1Statement(env, `UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).run(timestamp, timestamp, user.id)
    return appendCookies(
      sendJson(request, env, { message: 'Account created. Secure session is active.', user: serializeUser(user) }, 201),
      [buildCookie(sessionCookieName, token, request, sessionTtlSeconds)],
    )
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    const body = await readJsonBody(request)
    const email = normalizeEmail(body.email)
    const user = await d1Statement(env, `SELECT * FROM users WHERE email = ?`).get(email)
    if (!user || !(await verifyPassword(String(body.password ?? ''), user.password_hash))) {
      throw new HttpError(401, 'Email or password is incorrect.')
    }

    if (user.status !== 'active') {
      throw new HttpError(403, 'This user account is disabled.')
    }

    const token = await createSessionForUser(env, user.id)
    const timestamp = nowIso()
    await d1Statement(env, `DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`).run(user.id, await sha256Hex(token))
    await d1Statement(env, `UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).run(timestamp, timestamp, user.id)
    return appendCookies(
      sendJson(request, env, { message: 'Signed in successfully.', user: serializeUser(user) }),
      [buildCookie(sessionCookieName, token, request, sessionTtlSeconds)],
    )
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const token = parseCookies(request)[sessionCookieName]
    if (token) {
      await d1Statement(env, `DELETE FROM sessions WHERE token_hash = ?`).run(await sha256Hex(token))
    }
    return appendCookies(sendJson(request, env, { message: 'Signed out successfully.' }), [
      clearCookie(sessionCookieName, request),
    ])
  }

  if (url.pathname === '/api/analytics/events' && request.method === 'POST') {
    const result = await createWorkerAnalyticsHelpers(env).ingestAnalyticsEvents(request)
    return sendJson(
      request,
      env,
      {
        message: 'Analytics events accepted.',
        accepted: true,
        persisted: true,
        ...result,
      },
      202,
    )
  }

  if (url.pathname === '/api/admin/analytics/summary' && request.method === 'GET') {
    await requireAdminUser(request, env)
    return sendJson(request, env, {
      summary: await createWorkerAnalyticsHelpers(env).getAdminAnalyticsSummary(url.searchParams.get('days')),
    })
  }

  if (url.pathname === '/api/admin/analytics/sessions' && request.method === 'GET') {
    await requireAdminUser(request, env)
    return sendJson(request, env, {
      sessions: await createWorkerAnalyticsHelpers(env).listAdminAnalyticsSessions({
        days: url.searchParams.get('days'),
        limit: url.searchParams.get('limit'),
      }),
    })
  }

  const analyticsSessionMatch = url.pathname.match(/^\/api\/admin\/analytics\/sessions\/([a-z0-9-]+)$/)
  if (analyticsSessionMatch && request.method === 'GET') {
    await requireAdminUser(request, env)
    return sendJson(request, env, await createWorkerAnalyticsHelpers(env).getAdminAnalyticsSessionDetail(analyticsSessionMatch[1]))
  }

  if (url.pathname === '/api/admin/users' && request.method === 'GET') {
    await requireAdminUser(request, env)
    const users = await d1Statement(
      env,
      `SELECT id, email, name, role, status, created_at, updated_at, last_login_at
       FROM users
       WHERE email != ?
       ORDER BY created_at ASC`,
    ).all(guestUserEmail)
    return sendJson(request, env, { users: users.map(serializeUser) })
  }

  if (url.pathname === '/api/admin/users' && request.method === 'POST') {
    await requireAdminUser(request, env)
    const body = await readJsonBody(request)
    const user = await createUserRecord(env, {
      email: body.email,
      name: body.name,
      password: body.password,
      role: body.role === 'admin' ? 'admin' : 'operator',
    })
    return sendJson(request, env, { message: 'User created successfully.', user: serializeUser(user) }, 201)
  }

  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([a-f0-9]+)$/)
  if (adminUserMatch && request.method === 'PATCH') {
    const context = await requireAdminUser(request, env)
    if (adminUserMatch[1] === context.user.id) {
      throw new HttpError(400, 'Current admin cannot be modified here.')
    }

    const body = await readJsonBody(request)
    const name = sanitizeName(body.name)
    validateNameInput(name)
    const role = body.role === 'admin' ? 'admin' : 'operator'
    const status = body.status === 'disabled' ? 'disabled' : 'active'
    await d1Statement(env, `UPDATE users SET name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?`).run(
      name,
      role,
      status,
      nowIso(),
      adminUserMatch[1],
    )
    const user = await d1Statement(env, `SELECT * FROM users WHERE id = ?`).get(adminUserMatch[1])
    return sendJson(request, env, { message: 'User updated successfully.', user: serializeUser(user) })
  }

  if (url.pathname === '/api/console-data' && request.method === 'GET') {
    const context = await requireOrderAccessContext(request, env)
    return sendJson(request, env, {
      orders: await listVisibleOrders(env, context),
      claws: await listVisibleAgentInstances(env, context),
      users:
        context.kind === 'user' && context.user.role === 'admin'
          ? (await d1Statement(
              env,
              `SELECT id, email, name, role, status, created_at, updated_at, last_login_at
               FROM users
               WHERE email != ?
               ORDER BY created_at ASC`,
            ).all(guestUserEmail)).map(serializeUser)
          : [],
    })
  }

  if (url.pathname === '/api/launch-checkout' && request.method === 'POST') {
    const body = await readJsonBody(request)
    const result = await createD1LaunchCheckout(body, request, env)
    return appendCookies(sendJson(request, env, result.payload), [
      result.guestToken ? buildCookie(guestCookieName, result.guestToken, request, guestTtlSeconds) : null,
    ])
  }

  if (url.pathname === '/api/orders' && request.method === 'GET') {
    const context = await requireOrderAccessContext(request, env)
    return sendJson(request, env, { orders: await listVisibleOrders(env, context) })
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9]+)$/)
  if (orderMatch && request.method === 'GET') {
    const context = await requireOrderAccessContext(request, env)
    const order = await d1Statement(env, `SELECT * FROM orders WHERE id = ?`).get(orderMatch[1])
    await assertD1OrderAccess(context, order)
    return sendJson(request, env, { order: await serializeOrder(env, order, context) })
  }

  const checkoutMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9]+)\/checkout-session$/)
  if (checkoutMatch && request.method === 'POST') {
    const context = await requireOrderAccessContext(request, env)
    const order = await d1Statement(env, `SELECT * FROM orders WHERE id = ?`).get(checkoutMatch[1])
    await assertD1OrderAccess(context, order)
    return sendJson(request, env, await createCheckoutSessionForD1Order(env, request, order, context))
  }

  const creemConfirmMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9]+)\/creem-confirm$/)
  if (creemConfirmMatch && request.method === 'POST') {
    const context = await requireOrderAccessContext(request, env)
    const order = await d1Statement(env, `SELECT * FROM orders WHERE id = ?`).get(creemConfirmMatch[1])
    await assertD1OrderAccess(context, order)
    if (order.payment_status === 'paid') {
      return sendJson(request, env, { message: 'Payment already confirmed.', order: await serializeOrder(env, order, context) })
    }

    const body = await readJsonBody(request)
    const redirectParams = body.redirectParams && typeof body.redirectParams === 'object' ? body.redirectParams : {}
    const checkoutId = String(redirectParams.checkout_id ?? body.checkoutId ?? '').trim()
    if (!checkoutId) {
      throw new HttpError(400, 'Creem redirect payload is incomplete.')
    }

    if (order.creem_checkout_id && checkoutId !== order.creem_checkout_id) {
      throw new HttpError(400, 'Creem checkout does not belong to this order.')
    }

    const checkout = await getCreemCheckoutSession(env, checkoutId)
    const checkoutRequestId = checkout?.request_id ? String(checkout.request_id) : null
    const checkoutStatus = String(checkout?.status ?? '').toLowerCase()
    const orderStatus = String(checkout?.order?.status ?? '').toLowerCase()
    if (checkoutRequestId && checkoutRequestId !== order.id) {
      throw new HttpError(400, 'Creem checkout does not belong to this order.')
    }

    if (checkoutStatus !== 'completed' && orderStatus !== 'paid' && orderStatus !== 'completed') {
      throw new HttpError(400, 'Creem checkout is not completed yet.')
    }

    const paidOrder = await markD1OrderPaid(env, order)
    return sendJson(request, env, {
      message: 'Creem payment confirmed. Your Ruflo workspace is in the provisioning queue.',
      order: await serializeOrder(env, paidOrder, context),
    })
  }

  const paypalCaptureMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9]+)\/paypal-capture$/)
  if (paypalCaptureMatch && request.method === 'POST') {
    const context = await requireOrderAccessContext(request, env)
    const order = await d1Statement(env, `SELECT * FROM orders WHERE id = ?`).get(paypalCaptureMatch[1])
    await assertD1OrderAccess(context, order)
    const body = await readJsonBody(request)
    const paidOrder = await capturePayPalOrder(env, order, body.paypalOrderId ?? order.paypal_order_id)
    return sendJson(request, env, {
      message: 'PayPal payment confirmed. Your Ruflo workspace is in the provisioning queue.',
      order: await serializeOrder(env, paidOrder, context),
    })
  }

  return null
}

function normalizeSeoPathname(pathname) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getSeoFallbackContent(normalizedPath, seo) {
  return (
    seoFallbackContent.get(normalizedPath) ?? {
      heading: seo.title,
      intro: seo.description,
      points: [
        'Return to the Ruflo AI homepage to launch a hosted multi-agent workspace.',
        'Use the public guides for Codex, Claude Code, memory, RAG, and repeatable agent work.',
        'Review plans only after you have a concrete workflow in mind.',
      ],
    }
  )
}

function renderSeoFallbackHtml(seo, normalizedPath) {
  const content = getSeoFallbackContent(normalizedPath, seo)
  const points = content.points.map((point) => `<li>${escapeHtmlText(point)}</li>`).join('')

  return `<main id="ruflo-seo-fallback" aria-label="Ruflo AI page summary"><h1>${escapeHtmlText(content.heading)}</h1><p>${escapeHtmlText(content.intro)}</p><ul>${points}</ul></main>`
}

function injectSeoFallback(html, seo, pathname) {
  const normalizedPath = normalizeSeoPathname(pathname)
  const fallback = renderSeoFallbackHtml(seo, normalizedPath)
  return html.replace(/<div\s+id=["']root["']\s*><\/div>/i, `<div id="root">${fallback}</div>`)
}

function injectSeoFallbackBootGuard(html) {
  const guard = `<script>document.documentElement.classList.add('js-enabled');setTimeout(function(){var root=document.getElementById('root');if(root&&root.querySelector&&root.querySelector('#ruflo-seo-fallback'))document.documentElement.classList.remove('js-enabled')},4000)</script><style>.js-enabled #ruflo-seo-fallback{position:fixed!important;inset:0!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important}</style>`
  return html.includes('js-enabled #ruflo-seo-fallback') ? html : html.replace('</head>', `    ${guard}\n  </head>`)
}

function replaceHeadTag(html, pattern, replacement) {
  if (pattern.test(html)) {
    return html.replace(pattern, replacement)
  }

  return html.replace('</head>', `    ${replacement}\n  </head>`)
}

function getSeoConfig(request, env, pathname) {
  const normalizedPath = normalizeSeoPathname(pathname)
  const origin = getRequestOrigin(request, env)
  const page = seoPageMap.get(normalizedPath)
  const canonicalPath = page?.canonicalPath ?? normalizedPath
  const canonicalUrl = new URL(canonicalPath, `${origin}/`).toString()

  if (page) {
    const { canonicalPath: _canonicalPath, ...seo } = page
    return {
      ...seo,
      keywords: [...(seo.keywords ?? []), ...defaultSiteKeywords],
      canonicalUrl,
    }
  }

  return {
    title: 'Page not found | Ruflo AI',
    description:
      'This Ruflo AI page could not be matched to a public route. Return to the homepage to continue.',
    keywords: defaultSiteKeywords,
    robots: 'noindex,follow',
    canonicalUrl,
  }
}

function getPlanOfferStructuredData(origin) {
  return planCatalog.flatMap((plan) => {
    const monthlyPrice = plan.monthlyAmountCents / 100
    const yearlyPrice = Math.round(plan.monthlyAmountCents * 12 * annualBillingMultiplier) / 100

    return [
      {
        '@type': 'Offer',
        name: `${plan.name} monthly`,
        price: String(monthlyPrice),
        priceCurrency: plan.currency,
        availability: 'https://schema.org/InStock',
        url: new URL(`/plans?plan=${encodeURIComponent(plan.id)}&billing=monthly`, `${origin}/`).toString(),
      },
      {
        '@type': 'Offer',
        name: `${plan.name} yearly`,
        price: String(yearlyPrice),
        priceCurrency: plan.currency,
        availability: 'https://schema.org/InStock',
        url: new URL(`/plans?plan=${encodeURIComponent(plan.id)}&billing=annual`, `${origin}/`).toString(),
      },
    ]
  })
}

function getDefaultFaqStructuredData() {
  return {
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What does Ruflo AI do?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Ruflo AI provides a hosted workspace path for multi-agent planning, Codex or Claude Code entrypoints, memory, review, checkout, and provisioning follow-up.',
        },
      },
      {
        '@type': 'Question',
        name: 'How much does Ruflo AI cost?',
        acceptedAnswer: {
          '@type': 'Answer',
          text:
            'Ruflo AI lists Starter at $19/mo, Growth at $49/mo, and Scale at $149/mo before annual billing discounts.',
        },
      },
      {
        '@type': 'Question',
        name: 'Who operates support for Ruflo AI?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Ruflo AI support is available at support@aigeamy.com for checkout, provisioning, and hosted workspace questions.',
        },
      },
    ],
  }
}

function getRouteStructuredData(seo, normalizedPath) {
  const canonical = new URL(seo.canonicalUrl)
  const origin = canonical.origin
  const webPage = {
    '@type': 'WebPage',
    name: seo.title,
    description: seo.description,
    url: seo.canonicalUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Ruflo AI',
      url: new URL('/', `${origin}/`).toString(),
    },
    publisher: {
      '@type': 'Organization',
      name: 'Ruflo AI',
      email: 'support@aigeamy.com',
      url: new URL('/', `${origin}/`).toString(),
    },
  }

  const softwareApplication = {
    '@type': 'SoftwareApplication',
    name: 'Ruflo AI',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: new URL('/', `${origin}/`).toString(),
    description: defaultSiteDescription,
    provider: {
      '@type': 'Organization',
      name: 'Ruflo AI',
      email: 'support@aigeamy.com',
    },
    offers: getPlanOfferStructuredData(origin),
  }

  if (normalizedPath === '/plans') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        webPage,
        {
          '@type': 'Product',
          name: 'Ruflo AI',
          description: seo.description,
          url: seo.canonicalUrl,
          offers: getPlanOfferStructuredData(origin),
        },
        getDefaultFaqStructuredData(),
      ],
    }
  }

  if (normalizedPath === '/resources') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          ...webPage,
          '@type': 'CollectionPage',
        },
        getDefaultFaqStructuredData(),
      ],
    }
  }

  if (normalizedPath === '/checkout' || normalizedPath === '/plans' || normalizedPath === '/') {
    return {
      '@context': 'https://schema.org',
      '@graph': [webPage, softwareApplication, getDefaultFaqStructuredData()],
    }
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [webPage, getDefaultFaqStructuredData()],
  }
}

function replaceStructuredData(html, seo, normalizedPath) {
  const payload = getRouteStructuredData(seo, normalizedPath)
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  const script = `<script type="application/ld+json" data-ruflo-schema>${json}</script>`
  return replaceHeadTag(html, /<script\b(?=[^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/i, script)
}

function renderSeoHtml(request, env, pathname, templateHtml) {
  const seo = getSeoConfig(request, env, pathname)
  const normalizedPath = normalizeSeoPathname(pathname)
  const ogImageUrl = new URL('/og-image.png', `${getRequestOrigin(request, env) || defaultOrigin}/`).toString()

  let html = templateHtml
  html = injectSeoFallbackBootGuard(html)
  html = replaceHeadTag(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttribute(seo.title)}</title>`)
  html = replaceHeadTag(
    html,
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${escapeHtmlAttribute(seo.description)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+name="keywords"[^>]*>/i,
    `<meta name="keywords" content="${escapeHtmlAttribute([...new Set(seo.keywords)].join(', '))}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+name="robots"[^>]*>/i,
    `<meta name="robots" content="${escapeHtmlAttribute(seo.robots)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<link\s+rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${escapeHtmlAttribute(seo.canonicalUrl)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:site_name"[^>]*>/i,
    `<meta property="og:site_name" content="Ruflo AI" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${escapeHtmlAttribute(seo.title)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${escapeHtmlAttribute(seo.description)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${escapeHtmlAttribute(seo.canonicalUrl)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:image"[^>]*>/i,
    `<meta property="og:image" content="${escapeHtmlAttribute(ogImageUrl)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:image:width"[^>]*>/i,
    '<meta property="og:image:width" content="1200" />',
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:image:height"[^>]*>/i,
    '<meta property="og:image:height" content="630" />',
  )
  html = replaceHeadTag(
    html,
    /<meta\s+name="twitter:title"[^>]*>/i,
    `<meta name="twitter:title" content="${escapeHtmlAttribute(seo.title)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+name="twitter:description"[^>]*>/i,
    `<meta name="twitter:description" content="${escapeHtmlAttribute(seo.description)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+name="twitter:image"[^>]*>/i,
    `<meta name="twitter:image" content="${escapeHtmlAttribute(ogImageUrl)}" />`,
  )
  html = replaceStructuredData(html, seo, normalizedPath)

  html = injectSeoFallback(html, seo, pathname)

  return withMirofishReference(html, request)
}

function renderRobotsTxt(request, env) {
  const origin = getRequestOrigin(request, env) || defaultOrigin
  return sendText(
    request,
    env,
    `User-agent: *\nContent-Signal: search=yes,ai-input=yes,ai-train=no\nAllow: /\nAllow: /llms.txt\nSitemap: ${origin}/sitemap.xml\n`,
    'text/plain; charset=utf-8',
  )
}

function renderSitemapXml(request, env) {
  const origin = getRequestOrigin(request, env) || defaultOrigin
  const urls = indexableSitemapPaths
    .map((path) => `  <url>\n    <loc>${new URL(path, `${origin}/`).toString()}</loc>\n  </url>`)
    .join('\n')

  return sendText(
    request,
    env,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'application/xml; charset=utf-8',
  )
}

async function handleApiRequest(request, env) {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request, env),
    })
  }

  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    verifyOrigin(request, env)
  }

  if (url.pathname === '/api/nowpayments-checkout') {
    return handleNowPaymentsCheckout(request, env, {
      plans: planCatalog,
      defaultPlanId: 'growth',
      siteName: 'ruflo',
      siteKey: 'ruflo',
      annualDiscountMultiplier: typeof ANNUAL_DISCOUNT_MULTIPLIER !== 'undefined'
        ? ANNUAL_DISCOUNT_MULTIPLIER
        : (typeof annualBillingMultiplier !== 'undefined' ? annualBillingMultiplier : 0.5),
    })
  }

  if (url.pathname === '/api/runtime' && request.method === 'GET') {
    return sendJson(request, env, {
      environment: 'production',
      publicAppOrigin: getRequestOrigin(request, env),
      deploymentMode: 'manual',
      isDevelopment: false,
    })
  }

  if (url.pathname === '/api/catalog' && request.method === 'GET') {
    return sendJson(request, env, {
      plans: planCatalog.map(serializePlan),
      models: modelCatalog,
      channels: channelCatalog,
    })
  }

  if (url.pathname === '/api/analytics' && request.method === 'GET') {
    return sendJson(request, env, {
      configured: true,
      endpoint: '/api/analytics/events',
      storage: hasD1Database(env) ? 'cloudflare_d1' : 'ephemeral_ack',
      adminEndpoints: hasD1Database(env)
        ? ['/api/admin/analytics/summary', '/api/admin/analytics/sessions']
        : [],
    })
  }

  if (hasD1Database(env)) {
    const d1Response = await handleD1ApiRequest(request, env)
    if (d1Response) {
      return d1Response
    }
  }

  if (url.pathname === '/api/analytics/events' && request.method === 'POST') {
    return sendJson(
      request,
      env,
      {
        message: 'Analytics events accepted.',
        accepted: true,
        persisted: false,
      },
      202,
    )
  }

  if (url.pathname === '/api/launch-checkout' && request.method === 'POST') {
    const body = await readJsonBody(request)
    return sendJson(request, env, await createStatelessCheckout(body, request, env))
  }

  if (url.pathname === '/api/meta/robots.txt' && request.method === 'GET') {
    return renderRobotsTxt(request, env)
  }

  if (url.pathname === '/api/meta/sitemap.xml' && request.method === 'GET') {
    return renderSitemapXml(request, env)
  }

  return sendJson(request, env, { message: 'Not found.' }, 404)
}

function isHtmlPageRequest(request, url) {
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    return false
  }

  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return false
  }

  const accept = request.headers.get('Accept') ?? ''
  return !accept || accept.includes('text/html') || accept.includes('*/*')
}

async function fetchAsset(request, env, assetFetcher) {
  if (assetFetcher) {
    return await assetFetcher(request, env)
  }

  if (env?.ASSETS?.fetch) {
    return await env.ASSETS.fetch(request)
  }

  return new Response('Cloudflare ASSETS binding is unavailable.', {
    status: 500,
    headers: getSecurityHeaders(),
  })
}

function isStaticAssetPath(pathname) {
  return (
    pathname.startsWith('/assets/') ||
    pathname === '/favicon.svg' ||
    pathname === '/og-image.png' ||
    /\.(?:avif|css|gif|ico|jpg|jpeg|js|mjs|png|svg|webp|woff2?)$/i.test(pathname)
  )
}

function isHtmlRoutePath(pathname) {
  return !/\.[a-z0-9]+$/i.test(pathname)
}

function buildAssetRequest(request, pathname) {
  const assetUrl = new URL(request.url)
  assetUrl.pathname = pathname
  assetUrl.search = ''
  return new Request(assetUrl, request)
}

async function fetchSpaAsset(request, env, assetFetcher) {
  const url = new URL(request.url)
  const normalizedPath = normalizeSeoPathname(url.pathname)

  if (!isHtmlRoutePath(url.pathname)) {
    return await fetchAsset(request, env, assetFetcher)
  }

  const appShellPaths = new Set(['/plans', '/checkout', '/console'])
  const candidatePaths = appShellPaths.has(normalizedPath)
    ? ['/index.html']
    : [
        normalizedPath === '/' ? '/index.html' : `${normalizedPath}/index.html`,
        '/index.html',
      ]

  for (const candidatePath of [...new Set(candidatePaths)]) {
    const response = await fetchAsset(buildAssetRequest(request, candidatePath), env, assetFetcher)
    if (response.status !== 404 && response.status < 300) {
      return response
    }
  }

  const response = await fetchAsset(request, env, assetFetcher)
  if (response.status < 300 || response.status === 404) {
    return response
  }

  return await fetchAsset(buildAssetRequest(request, '/index.html'), env, assetFetcher)
}

function setAssetCacheHeaders(pathname, headers) {
  if (!isStaticAssetPath(pathname)) {
    return
  }

  if (pathname.startsWith('/assets/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    return
  }

  headers.set('Cache-Control', 'public, max-age=86400')
}

async function renderHtmlAsset(request, env, assetFetcher) {
  const url = new URL(request.url)
  const normalizedPath = normalizeSeoPathname(url.pathname)
  const isKnownPage = seoPageMap.has(normalizedPath)
  const assetResponse = await fetchSpaAsset(request, env, assetFetcher)

  if (!assetResponse.ok) {
    return assetResponse
  }

  const contentType = assetResponse.headers.get('Content-Type') ?? ''
  if (!contentType.includes('text/html')) {
    return assetResponse
  }

  const headers = new Headers(assetResponse.headers)
  const body = renderSeoHtml(request, env, url.pathname, await assetResponse.text())
  const status = isKnownPage ? assetResponse.status : 404
  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('Content-Length', String(new TextEncoder().encode(body).length))
  headers.set('Cache-Control', 'no-store')
  if (!isKnownPage) {
    headers.set('X-Robots-Tag', 'noindex, follow')
  }
  for (const [key, value] of getSecurityHeaders()) {
    headers.set(key, value)
  }

  if (request.method === 'HEAD') {
    return new Response(null, {
      status,
      headers,
    })
  }

  return new Response(body, {
    status,
    headers,
  })
}

function getCanonicalRedirectResponse(request) {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    return null
  }

  const url = new URL(request.url)
  const isLiveHost = url.hostname === 'ruflo.online' || url.hostname === 'www.ruflo.online'
  if (!isLiveHost) {
    return null
  }

  const target = new URL(url)
  let changed = false

  if (target.protocol !== 'https:') {
    target.protocol = 'https:'
    changed = true
  }

  if (target.hostname === 'www.ruflo.online') {
    target.hostname = 'ruflo.online'
    changed = true
  }

  const indexRedirects = new Map([
    ['/pricing', '/plans'],
    ['/pricing/', '/plans'],
    ['/pricing/index.html', '/plans'],
    ['/resources/index.html', '/resources/'],
    ['/checkout', '/plans'],
    ['/checkout/', '/plans'],
    ['/checkout/index.html', '/plans'],
  ])
  const indexRedirect = indexRedirects.get(target.pathname)
  if (indexRedirect) {
    target.pathname = indexRedirect
    changed = true
  } else if (target.pathname.endsWith('/index.html')) {
    const directoryPath = target.pathname.replace(/\/index\.html$/i, '') || '/'
    target.pathname = directoryCanonicalPaths.has(directoryPath) ? `${directoryPath}/` : directoryPath
    changed = true
  } else if (
    target.pathname.length > 1 &&
    target.pathname.endsWith('/')
  ) {
    const directoryPath = target.pathname.replace(/\/+$/, '')
    if (!directoryCanonicalPaths.has(directoryPath)) {
      target.pathname = directoryPath
      changed = true
    }
  }

  if (!changed) {
    return null
  }

  const headers = getSecurityHeaders()
  headers.set('Location', target.toString())
  headers.set('Cache-Control', 'public, max-age=3600')
  return new Response(null, {
    status: 301,
    headers,
  })
}

export async function handleCloudflareRequest(request, env, options = {}) {
  const url = new URL(request.url)
  const assetFetcher = options.assetFetcher

  try {
    const redirectResponse = getCanonicalRedirectResponse(request)
    if (redirectResponse) {
      return redirectResponse
    }

    if (url.pathname.startsWith('/api/')) {
      return await handleApiRequest(request, env)
    }

    if (url.pathname === '/robots.txt') {
      return renderRobotsTxt(request, env)
    }

    if (url.pathname === '/sitemap.xml') {
      return renderSitemapXml(request, env)
    }

    if (isHtmlPageRequest(request, url)) {
      return await renderHtmlAsset(request, env, assetFetcher)
    }

    const response = await fetchAsset(request, env, assetFetcher)
    const headers = new Headers(response.headers)
    setAssetCacheHeaders(url.pathname, headers)
    for (const [key, value] of getSecurityHeaders()) {
      headers.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (error) {
    const status = error instanceof HttpError ? error.statusCode : 500
    return sendJson(
      request,
      env,
      {
        message: error instanceof Error ? error.message : 'Request failed.',
      },
      status,
    )
  }
}

export default {
  async fetch(request, env) {
    return await handleCloudflareRequest(request, env)
  },
}
