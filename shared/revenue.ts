// Revenue sources: where a project's payments and subscriptions come from.
// Every source writes the same two tables (the `StripePayment` and
// `StripeSubscription` classes keep their first name), tagged with `source`, so
// the Revenue tab, the overview and a person's billing section read them all
// alike. Shared by the server and the panel; the native app copies the list by
// hand (tests/revenueNativeParity.test.ts).
//
//   pull    HelpBites reads the service with a credential, on the worker's tick.
//   push    The service calls HelpBites (a webhook) with a secret HelpBites made.
//   manual  Nothing is read: you send payments to the API.

export const REVENUE_SOURCE_IDS = ['stripe', 'revenuecat', 'apple', 'paddle', 'lemonsqueezy', 'custom'] as const
export type RevenueSourceId = typeof REVENUE_SOURCE_IDS[number]

export type RevenueSourceField = {
  key: string
  placeholder?: string
  /** Shown as dots and never returned by the API once saved. */
  secret?: boolean
  multiline?: boolean
  optional?: boolean
}

export type RevenueSourceInfo = {
  id: RevenueSourceId
  /** The product's name, as the server writes it (the panel has its own translations). */
  name: string
  icon: string
  kind: 'pull' | 'push' | 'manual'
  /** What a person types to connect it; the labels and help are `projectTools.revenue.sources.<id>.fields.<key>.*` in the locale files. */
  fields: RevenueSourceField[]
  /** False when the source only reports payments: no MRR, subscribers or plans. */
  subscriptions: boolean
}

export const REVENUE_SOURCES: RevenueSourceInfo[] = [
  { id: 'stripe', name: 'Stripe', icon: 'i-lucide-credit-card', kind: 'pull', subscriptions: true, fields: [{ key: 'apiKey', placeholder: 'rk_live_…', secret: true }] },
  { id: 'revenuecat', name: 'RevenueCat', icon: 'i-lucide-cat', kind: 'push', subscriptions: true, fields: [] },
  {
    id: 'apple', name: 'App Store', icon: 'i-lucide-apple', kind: 'pull', subscriptions: false,
    fields: [
      { key: 'issuerId', placeholder: '69a6de70-…' },
      { key: 'keyId', placeholder: 'ABC123DEFG' },
      { key: 'vendorNumber', placeholder: '12345678' },
      { key: 'privateKey', placeholder: '-----BEGIN PRIVATE KEY-----', secret: true, multiline: true }
    ]
  },
  { id: 'paddle', name: 'Paddle', icon: 'i-lucide-waves', kind: 'pull', subscriptions: true, fields: [{ key: 'apiKey', placeholder: 'pdl_live_apikey_…', secret: true }] },
  { id: 'lemonsqueezy', name: 'Lemon Squeezy', icon: 'i-lucide-citrus', kind: 'pull', subscriptions: true, fields: [{ key: 'apiKey', placeholder: 'eyJ0eXAiOiJKV1Qi…', secret: true }] },
  { id: 'custom', name: 'Custom API', icon: 'i-lucide-code-xml', kind: 'manual', subscriptions: true, fields: [] }
]

export const revenueSource = (id: string) => REVENUE_SOURCES.find(s => s.id === id)
export const isRevenueSource = (id: unknown): id is RevenueSourceId => REVENUE_SOURCE_IDS.includes(id as RevenueSourceId)

/** The sources that are not Stripe: Stripe's rows predate the `source` field, so they are found as "not one of these". */
export const OTHER_SOURCES = REVENUE_SOURCE_IDS.filter(id => id !== 'stripe')

/** A row's key inside a project. Stripe's ids are kept as they are (they are unique and old rows have them); the rest are prefixed. */
export const rowKey = (source: RevenueSourceId, id: string) => (source === 'stripe' ? id : `${source}:${id}`)

/** A connected source as the API returns it; Stripe's is built from its own connection (server/utils/stripe.ts). */
export type RevenueConnection = {
  source: RevenueSourceId
  accountName: string
  livemode: boolean
  status: 'idle' | 'running' | 'error'
  /** The last run; for a push source, the last event it sent. */
  lastRunAt: string | null
  lastError: string
  stats: { payments: number, subscriptions: number }
  /** A push source: where the service sends its events, and the secret to put in its Authorization header. Only members who manage the project get the secret. */
  webhook?: { url: string, token: string }
}

/** What `POST /v1/admin/revenue/payments` takes. Amounts are decimals in the currency's units (19.99), not cents. */
export type CustomPayment = {
  id: string
  amount: number
  currency: string
  paidAt?: string | number
  email?: string
  customerId?: string
  description?: string
  /** `succeeded` (the default) counts; anything else is kept but adds no revenue. */
  status?: string
  /** How much of it was given back, in the same units. */
  refunded?: number
  receiptUrl?: string
}

export type CustomSubscription = {
  id: string
  plan: string
  /** What it charges each period, in the currency's units. */
  amount: number
  currency: string
  interval: 'day' | 'week' | 'month' | 'year'
  intervalCount?: number
  /** One of shared/stripe.ts STRIPE_STATUSES; only active and past_due count towards MRR. */
  status: string
  email?: string
  customerId?: string
  startedAt?: string | number
  canceledAt?: string | number
  /** When it stopped being a customer (the end of the period they paid for); leave out while it runs. */
  endedAt?: string | number
}

/** What TestFlight reports for a build, an app or all of them. */
export type TestflightCounts = { installs: number, sessions: number, crashes: number, invites: number, feedback: number }

/** `GET /v1/admin/revenue/testflight`: the newest builds of each app on the App Store Connect account, with their beta usage. */
export type TestflightReport = {
  totals: TestflightCounts
  apps: {
    id: string
    name: string
    bundleId: string
    totals: TestflightCounts
    builds: (TestflightCounts & { id: string, version: string, build: string, uploadedAt: string | null, expired: boolean })[]
  }[]
}
