import type { LegalAnswers } from './types'

// Suggests wizard answers from what a project's code depends on. Deterministic
// and offline: a dependency, or a file in the repo tree, that we recognise maps
// to answers (Stripe → the Stripe processor and "payments"). Every suggestion
// carries the evidence that produced it, and the caller confirms it; nothing
// here decides what a policy says.

/** What was read from one repo: every file path in it, plus the manifests' text. */
export type RepoFiles = { repo: string, tree: string[], files: Array<{ path: string, content: string }> }
export type LegalSuggestions = { answers: LegalAnswers, evidence: Record<string, string[]> }

type Rule = {
  name: string
  /** A dependency name (lowercase) starts with one of these. */
  needles?: string[]
  /** Or a file path in the tree matches. */
  paths?: RegExp[]
  processors?: string[]
  /** A service with no entry in LEGAL_PROCESSORS: "Name (purpose)", added to "other services". */
  other?: string
  data?: string[]
  cookies?: string[]
  platforms?: string[]
  ai?: boolean
  ads?: boolean
  subscriptions?: boolean
  billing?: 'store' | 'direct'
}

const MOBILE = ['react-native', 'expo', 'flutter', 'capacitor', '@capacitor/', 'cordova']

export const LEGAL_DETECT_RULES: Rule[] = [
  // payments
  { name: 'Stripe', needles: ['stripe', '@stripe/', 'github.com/stripe/', 'com.stripe'], processors: ['stripe'], data: ['payments'], billing: 'direct' },
  { name: 'RevenueCat', needles: ['revenuecat', '@revenuecat/', 'react-native-purchases', 'purchases-flutter', 'purchases_flutter', 'purchases-android', 'purchases-ios', 'com.revenuecat'], processors: ['revenuecat'], data: ['payments'], subscriptions: true, billing: 'store' },
  { name: 'In-app purchases', needles: ['react-native-iap', 'in_app_purchase', 'expo-in-app-purchases', 'cordova-plugin-purchase', 'storekit'], processors: ['apple_iap', 'google_play_billing'], data: ['payments'], billing: 'store' },
  { name: 'Google Play Billing', needles: ['com.android.billingclient'], processors: ['google_play_billing'], data: ['payments'], billing: 'store' },
  { name: 'PayPal', needles: ['paypal', '@paypal/'], other: 'PayPal (payment processing)', data: ['payments'], billing: 'direct' },
  { name: 'Paddle', needles: ['@paddle/', 'paddle-'], other: 'Paddle (payment processing)', data: ['payments'], billing: 'direct' },
  // Firebase
  { name: 'Firebase', needles: ['firebase', '@firebase/', '@react-native-firebase/', 'firebase_', 'cloud_firestore', 'com.google.firebase:', 'com.google.gms:google-services'], paths: [/(^|\/)(GoogleService-Info\.plist|google-services\.json)$/], processors: ['firebase'] },
  { name: 'Firebase Analytics', needles: ['firebase_analytics', '@react-native-firebase/analytics', 'com.google.firebase:firebase-analytics', 'firebase/analytics', 'firebase-analytics'], data: ['analytics', 'device'] },
  { name: 'Firebase Crashlytics', needles: ['firebase_crashlytics', '@react-native-firebase/crashlytics', 'com.google.firebase:firebase-crashlytics', 'firebase/crashlytics', 'firebase-crashlytics'], data: ['crash'] },
  { name: 'Firebase Authentication', needles: ['firebase_auth', '@react-native-firebase/auth', 'com.google.firebase:firebase-auth', 'firebase/auth', 'firebase-auth'], data: ['account'] },
  // analytics and crashes
  { name: 'Google Analytics', needles: ['react-ga', 'vue-gtag', 'nuxt-gtag', '@nuxtjs/google-analytics', '@analytics/google-analytics', 'google-analytics', 'ngx-google-analytics', 'gtag'], processors: ['google_analytics'], data: ['analytics', 'device'], cookies: ['analytics'] },
  { name: 'PostHog', needles: ['posthog'], processors: ['posthog'], data: ['analytics', 'device'], cookies: ['analytics'] },
  { name: 'Mixpanel', needles: ['mixpanel'], processors: ['mixpanel'], data: ['analytics', 'device'], cookies: ['analytics'] },
  { name: 'Amplitude', needles: ['amplitude', '@amplitude/'], other: 'Amplitude (product analytics)', data: ['analytics', 'device'], cookies: ['analytics'] },
  { name: 'Segment', needles: ['@segment/', 'analytics-node', 'analytics-next', 'analytics-python', 'com.segment'], other: 'Segment (analytics routing)', data: ['analytics', 'device'], cookies: ['analytics'] },
  { name: 'Sentry', needles: ['sentry', '@sentry/', 'io.sentry'], processors: ['sentry'], data: ['crash', 'device'] },
  // advertising
  { name: 'Google AdMob', needles: ['google_mobile_ads', 'react-native-google-mobile-ads', 'com.google.android.gms:play-services-ads', 'google-mobile-ads', 'react-native-admob', 'expo-ads-admob', '@react-native-firebase/admob', 'googlemobileads'], processors: ['admob'], data: ['advertising', 'device'], ads: true },
  { name: 'Ad network', needles: ['applovin', 'com.applovin', 'unityads', 'com.unity3d.ads', 'ironsource', 'com.ironsource', 'com.facebook.android:audience-network', 'react-native-fbads', 'appodeal', 'chartboost', 'vungle', 'mopub', 'inmobi'], data: ['advertising', 'device'], ads: true },
  { name: 'Web ads', needles: ['react-adsense', 'vue-google-adsense', 'nuxt-adsense', '@nuxtjs/google-adsense', 'nuxt-google-adsense'], data: ['advertising'], cookies: ['advertising'], ads: true },
  { name: 'AppsFlyer', needles: ['appsflyer', 'react-native-appsflyer', 'com.appsflyer'], other: 'AppsFlyer (attribution)', data: ['advertising', 'device'] },
  // AI
  { name: 'OpenAI', needles: ['openai', '@ai-sdk/openai', '@langchain/openai', 'langchain-openai', 'com.openai', 'github.com/openai/', 'github.com/sashabaranov/go-openai'], processors: ['openai'], ai: true },
  { name: 'Anthropic', needles: ['anthropic', '@anthropic-ai/', '@ai-sdk/anthropic', '@langchain/anthropic', 'langchain-anthropic', 'github.com/anthropics/'], processors: ['anthropic'], ai: true },
  { name: 'Google Gemini', needles: ['@google/generative-ai', '@google/genai', 'google-generativeai', 'google-genai', '@ai-sdk/google'], other: 'Google Gemini (AI features)', ai: true },
  { name: 'Other AI providers', needles: ['mistralai', '@mistralai/', 'cohere', 'groq', 'replicate'], ai: true },
  // accounts, content, support, location
  { name: 'Sign-in', needles: ['next-auth', '@auth/', 'better-auth', 'passport', 'devise', 'omniauth', 'django-allauth', 'fastapi-users', 'flask-login', 'flask-security', 'nuxt-auth-utils', '@sidebase/nuxt-auth', 'lucia', 'keycloak', 'spring-security', 'express-session', 'cookie-session', 'iron-session'], data: ['account'], cookies: ['essential'] },
  { name: 'Clerk', needles: ['@clerk/', 'clerk'], other: 'Clerk (authentication)', data: ['account'], cookies: ['essential'] },
  { name: 'Auth0', needles: ['auth0', '@auth0/'], other: 'Auth0 (authentication)', data: ['account'], cookies: ['essential'] },
  { name: 'Supabase', needles: ['supabase', '@supabase/'], other: 'Supabase (database and authentication)', data: ['account'] },
  { name: 'Uploads', needles: ['multer', 'uploadthing', '@uploadthing/', 'carrierwave', 'cloudinary', '@cloudinary/', 'react-dropzone', 'expo-image-picker', 'image_picker', 'react-native-image-picker', 'expo-document-picker', 'react-native-document-picker', 'file_picker'], data: ['user_content'] },
  { name: 'Intercom', needles: ['intercom', '@intercom/'], other: 'Intercom (customer support chat)', data: ['support'] },
  { name: 'Zendesk', needles: ['zendesk', '@zendesk/'], other: 'Zendesk (customer support)', data: ['support'] },
  { name: 'HelpBites', needles: ['helpbites', '@helpbites/'], data: ['support'] },
  { name: 'Location', needles: ['expo-location', 'react-native-geolocation', '@react-native-community/geolocation', 'react-native-background-geolocation', 'geolocator', 'com.google.android.gms:play-services-location'], data: ['location'] },
  // platforms
  { name: 'Mobile framework', needles: MOBILE, platforms: ['ios', 'android'] },
  { name: 'Xcode project', paths: [/\.xcodeproj\//, /(^|\/)Podfile$/, /(^|\/)ios\/[^/]+/], platforms: ['ios'] },
  { name: 'Android project', needles: ['com.android.application'], paths: [/(^|\/)AndroidManifest\.xml$/], platforms: ['android'] },
  { name: 'Web framework', needles: ['next', 'nuxt', 'react-dom', 'vue', 'svelte', '@sveltejs/', 'astro', '@angular/core', '@remix-run/', 'gatsby', 'django', 'flask', 'fastapi', 'rails', 'laravel/'], paths: [/(^|\/)(nuxt|next|vite|svelte|astro)\.config\.[cm]?[jt]s$/, /(^|\/)index\.html$/], platforms: ['web'] },
  { name: 'Desktop framework', needles: ['electron', '@tauri-apps/', 'neutralinojs'], paths: [/(^|\/)src-tauri\//], platforms: ['desktop'] }
]

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/**
 * Lowercase dependency-like names in a manifest. package.json is read as JSON
 * (its dependency keys only, not descriptions or scripts); every other kind of
 * manifest (Gemfile, go.mod, requirements.txt, Podfile, build.gradle, …) is
 * split into words, which is enough to see `gem 'stripe'` or `github.com/stripe/stripe-go`.
 */
export function manifestNames(path: string, content: string): string[] {
  if (base(path) === 'package.json') {
    try {
      const pkg = JSON.parse(content) as Record<string, unknown>
      return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap(key => pkg[key] && typeof pkg[key] === 'object' ? Object.keys(pkg[key] as object) : []).map(name => name.toLowerCase())
    } catch { /* not valid JSON: read it as words */ }
  }
  return [...new Set(content.toLowerCase().split(/[^a-z0-9_.@/:+-]+/).map(word => word.replace(/^[:.]+|[:.]+$/g, '')).filter(word => word.length > 1 && word.length < 100))]
}

const startsWithAny = (name: string, needles: string[]) => needles.some(needle => name.startsWith(needle))

/** Every name found in the scanned manifests that no rule recognises: the input to the optional AI pass. */
export function unknownNames(scans: RepoFiles[], limit = 400): string[] {
  const seen = new Set<string>()
  for (const scan of scans) {
    for (const file of scan.files) {
      for (const name of manifestNames(file.path, file.content)) {
        if (!/^[a-z@][a-z0-9_.@/:+-]*$/.test(name) || /^(https?|www)\b/.test(name) || LEGAL_DETECT_RULES.some(rule => rule.needles && startsWithAny(name, rule.needles))) continue
        seen.add(name)
        if (seen.size >= limit) return [...seen]
      }
    }
  }
  return [...seen]
}

const pushUnique = <T>(list: T[], items: T[]) => { for (const item of items) if (!list.includes(item)) list.push(item) }

/** Maps scanned repos to wizard answers, with the evidence for each question. */
export function detectLegalAnswers(scans: RepoFiles[]): LegalSuggestions {
  const answers: LegalAnswers = {}
  const evidence: Record<string, string[]> = {}
  const lists: Record<string, string[]> = {}
  const others: string[] = []
  const billing = new Set<string>()
  const note = (question: string, text: string) => {
    const list = evidence[question] ||= []
    if (!list.includes(text) && list.length < 8) list.push(text)
  }

  for (const scan of scans) {
    const names = scan.files.map(file => ({ path: file.path, names: manifestNames(file.path, file.content) }))
    for (const rule of LEGAL_DETECT_RULES) {
      let found = ''
      for (const file of names) {
        const hit = rule.needles && file.names.find(name => startsWithAny(name, rule.needles!))
        if (hit) { found = `${hit} in ${scan.repo} ${file.path}`; break }
      }
      if (!found && rule.paths) {
        const hit = scan.tree.find(path => rule.paths!.some(re => re.test(path)))
        if (hit) found = `${hit} in ${scan.repo}`
      }
      if (!found) continue
      const why = `${rule.name}: ${found}`
      const add = (question: string, values: string[]) => { pushUnique(lists[question] ||= [], values); note(question, why) }
      if (rule.processors) add('processors', rule.processors)
      if (rule.other) { pushUnique(others, [rule.other]); add('processors', ['other']); note('processors_other', why) }
      if (rule.data) add('data_collected', rule.data)
      if (rule.cookies) add('cookie_types', rule.cookies)
      if (rule.platforms) add('platforms', rule.platforms)
      if (rule.ai) { answers.ai_features = true; note('ai_features', why) }
      if (rule.ads) { answers.sells_or_shares_data = true; note('sells_or_shares_data', why) }
      if (rule.subscriptions) { answers.subscriptions = true; note('subscriptions', why) }
      if (rule.billing) { billing.add(rule.billing); note('refund_via', why) }
    }
  }

  Object.assign(answers, lists)
  if (others.length) answers.processors_other = others.join('\n')
  // Both kinds of billing, or neither: nothing to suggest.
  if (billing.size === 1) answers.refund_via = [...billing][0]
  else delete evidence.refund_via
  return { answers, evidence }
}

/**
 * Cleans what the model said about services we did not recognise. Each must
 * point at a dependency that really is in the scanned manifests, and its name
 * and purpose end up as plain text in a policy, so only letters, digits and
 * light punctuation survive.
 */
export function sanitizeServices(raw: unknown, known: Set<string>): Array<{ name: string, purpose: string, dependency: string }> {
  if (!Array.isArray(raw)) return []
  const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[^\p{L}\p{N} .,&'()+/-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const seen = new Set<string>()
  return raw.slice(0, 40).flatMap((item) => {
    const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const name = clean(s.name, 60)
    const purpose = clean(s.purpose, 100)
    const dependency = typeof s.dependency === 'string' ? s.dependency.trim().toLowerCase() : ''
    if (!name || !purpose || !known.has(dependency) || seen.has(name.toLowerCase())) return []
    seen.add(name.toLowerCase())
    return [{ name, purpose, dependency }]
  }).slice(0, 15)
}
