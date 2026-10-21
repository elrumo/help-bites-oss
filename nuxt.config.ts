import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DOCS, docPath } from './shared/docs'

// Two editions from one codebase (docs/EDITIONS.md). A cloud build adds the
// ee/ layer; every other build leaves it out, and the Dockerfile deletes the
// directory first so the community image holds only AGPL code.
const edition = process.env.HELPBITES_EDITION === 'cloud' ? 'cloud' : 'community'
if (edition === 'cloud' && !existsSync(new URL('./ee/nuxt.config.ts', import.meta.url))) {
  throw new Error('HELPBITES_EDITION=cloud needs the commercial ee/ layer, which is not part of the open-source repository (see docs/EDITIONS.md)')
}

const baselineHeaders = { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }

export default defineNuxtConfig({
  compatibilityDate: '2025-11-20',
  extends: edition === 'cloud' ? ['./ee'] : [],
  modules: ['@nuxt/ui', '@nuxtjs/i18n'],
  // No URL prefixes: the panel's routes stay as they are and the language is a
  // preference. First visit follows the browser's language; the choice is then
  // kept in a cookie (Settings → Appearance).
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'es', language: 'es-ES', name: 'Español', file: 'es.json' },
      { code: 'ca', language: 'ca-ES', name: 'Català', file: 'ca.json' },
      { code: 'zh', language: 'zh-CN', name: '中文', file: 'zh.json' },
      { code: 'ja', language: 'ja-JP', name: '日本語', file: 'ja.json' },
      { code: 'ko', language: 'ko-KR', name: '한국어', file: 'ko.json' }
    ],
    detectBrowserLanguage: { useCookie: true, cookieKey: 'hb_locale', fallbackLocale: 'en' },
    // A few messages quote HTML for the operator to read (emailEditor.htmlHelp); none is rendered as HTML.
    compilation: { strictMessage: false }
  },
  css: ['~/assets/css/main.css'],
  // Rendered on the server, but only where it buys something: the route rules
  // below keep the panel a client-side SPA and leave the landing page and the
  // docs — the pages crawlers and link previews ever see — as real prerendered
  // HTML.
  ssr: true,
  devtools: { enabled: false },

  app: {
    // Inter is self-hosted by @nuxt/fonts (NuxtUI's), found via --font-sans in
    // main.css. Pages switch instantly, as in Linear: no route transition.
    head: { title: 'help-bites', link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }] }
  },

  runtimeConfig: {
    public: {
      // Absolute origin of this deployment; used by widget.js and email CTAs.
      // Left empty when unset so the panel derives it from the browsed origin
      // (see useAppUrl) instead of showing a baked-in localhost URL.
      appUrl: process.env.APP_URL || '',
      sentryDsn: process.env.NUXT_PUBLIC_SENTRY_DSN || '',
      // Fixed at build time: which edition this bundle is.
      edition
    }
  },

  routeRules: {
    // The panel and the embed are client-rendered, as they were.
    '/**': { ssr: false },
    // Prerendered, so served as a static file before server middleware runs:
    // they get the baseline headers here instead (see server/middleware/securityHeaders.ts).
    '/': { ssr: true, prerender: true, headers: baselineHeaders },
    '/docs': { ssr: true, prerender: true, headers: baselineHeaders },
    '/docs/**': { ssr: true, prerender: true, headers: baselineHeaders },

    // The embed page is meant to be framed by any connected site; everything
    // else must never be.
    '/embed': { headers: { 'Content-Security-Policy': 'frame-ancestors *' } },
    '/embed/**': { headers: { 'Content-Security-Policy': 'frame-ancestors *' } },
    // The loaders talk to /embed from the same deploy, so a stale one must not
    // outlive a release by long: public/ otherwise gets no Cache-Control and
    // browsers guess a freshness of days.
    '/widget.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    '/feedback.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    '/changelog.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    '/blog.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    '/brand.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    // Onboarding must still show while HelpBites is unreachable, so a cached copy may be used for a week then.
    '/onboarding.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800' } },
    '/pages.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    '/forms.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    '/cms.mjs': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    // Versioned file names: a new version is a new path.
    '/vendor/**': { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
    '/v1/**': { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Workspace', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' } },
    // The MCP server and its sign-in documents: a browser-based assistant or inspector calls them cross-origin too.
    '/mcp': { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Workspace, Mcp-Protocol-Version', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'WWW-Authenticate' } },
    '/.well-known/**': { headers: { 'Access-Control-Allow-Origin': '*' } }
  },

  nitro: {
    preset: 'bun',
    experimental: { openAPI: true },
    // Nitro only prerenders the routes it is told about (it does not follow
    // links), so the guides are listed.
    prerender: { routes: DOCS.map(docPath) },
    openAPI: {
      // Served in production too: the API is the product, and integrators need the spec.
      production: 'runtime',
      meta: { title: 'help-bites API', description: 'Support chat for any app. Authenticate end users with a host-signed identity token, agents with a Parse session.', version: '1.0.0' },
      route: '/_docs/openapi.json',
      // Nitro's own Scalar page loads its bundle, unpinned, from a CDN onto this
      // origin; server/routes/_docs/scalar.get.ts serves a pinned copy instead.
      ui: { scalar: false, swagger: false }
    }
  },

  hooks: {
    // JSON errors for /v1 (server/error.ts) ahead of Nuxt's own handler, which
    // setting nitro.errorHandler here would replace. Also Scalar's self-contained
    // browser bundle, at /_docs/scalar-standalone.js: only that file, since the
    // rest of its dist/browser is ~40 MB of lazy chunks and source maps the page
    // never asks for. It falls through, so /_docs/scalar and /_docs/openapi.json
    // still reach their handlers.
    async 'nitro:config'(nitro) {
      nitro.errorHandler = ['~~/server/error', ...[nitro.errorHandler || []].flat()]
      const dir = resolve(nitro.rootDir!, 'node_modules/.cache/scalar')
      await mkdir(dir, { recursive: true })
      await copyFile(resolve(nitro.rootDir!, 'node_modules/@scalar/api-reference/dist/browser/standalone.js'), resolve(dir, 'scalar-standalone.js'))
      nitro.publicAssets ||= []
      nitro.publicAssets.push({ dir, baseURL: '/_docs', fallthrough: true })
    }
  }
})
