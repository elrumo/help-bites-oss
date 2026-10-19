import { existsSync } from 'node:fs'
import { DOCS, docPath } from './shared/docs'

// Two editions from one codebase (docs/EDITIONS.md). A cloud build adds the
// ee/ layer; every other build leaves it out, and the Dockerfile deletes the
// directory first so the community image holds only AGPL code.
const edition = process.env.HELPBITES_EDITION === 'cloud' ? 'cloud' : 'community'
if (edition === 'cloud' && !existsSync(new URL('./ee/nuxt.config.ts', import.meta.url))) {
  throw new Error('HELPBITES_EDITION=cloud needs the commercial ee/ layer, which is not part of the open-source repository (see docs/EDITIONS.md)')
}

export default defineNuxtConfig({
  compatibilityDate: '2025-11-20',
  extends: edition === 'cloud' ? ['./ee'] : [],
  modules: ['@nuxt/ui'],
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
    '/': { ssr: true, prerender: true },
    '/docs': { ssr: true, prerender: true },
    '/docs/**': { ssr: true, prerender: true },

    // The embed page is meant to be framed by any connected site; everything
    // else must never be.
    '/embed': { headers: { 'Content-Security-Policy': 'frame-ancestors *' } },
    '/embed/**': { headers: { 'Content-Security-Policy': 'frame-ancestors *' } },
    // The loaders talk to /embed from the same deploy, so a stale one must not
    // outlive a release by long: public/ otherwise gets no Cache-Control and
    // browsers guess a freshness of days.
    '/widget.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    '/feedback.js': { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
    '/v1/**': { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Workspace', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' } }
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
      ui: { scalar: { route: '/_docs/scalar', theme: 'purple' }, swagger: false }
    }
  },

  hooks: {
    // JSON errors for /v1 (server/error.ts) ahead of Nuxt's own handler, which
    // setting nitro.errorHandler here would replace.
    'nitro:config'(config) {
      config.errorHandler = ['~~/server/error', ...[config.errorHandler || []].flat()]
    }
  }
})
