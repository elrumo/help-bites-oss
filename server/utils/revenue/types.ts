import type { RevenueSourceId } from '#shared/revenue'
import type { PaymentRow, SubscriptionRow } from './rows'

// What a source that HelpBites reads (a "pull" source) provides. The orchestrator in
// server/utils/revenue.ts owns the row, the lock, the schedule and the error
// handling; an adapter only knows its service's API and how to turn it into rows.

export type Credentials = Record<string, string>

export type PullContext = {
  credentials: Credentials
  /** What the last stretch returned ({} for the first run, and after "Sync everything"). */
  cursor: Record<string, unknown>
  /** "Sync everything": read the whole history again, ignoring `cursor`. */
  reset: boolean
  /** Epoch ms. Stop at the next page boundary after this; the worker continues from your cursor. */
  deadline: number
  savePayments: (rows: PaymentRow[]) => Promise<void>
  saveSubscriptions: (rows: SubscriptionRow[]) => Promise<void>
}

export type PullResult = {
  /** Where to continue, or what the next incremental run starts from once `done`. */
  cursor: Record<string, unknown>
  /** False when the deadline came first: the worker calls `sync` again on its next tick. */
  done: boolean
}

export type PullAdapter = {
  id: RevenueSourceId
  /** Throws a 400 (the credentials are malformed) or 502 (the service refuses them) error; otherwise names the account. */
  check: (credentials: Credentials) => Promise<{ accountName: string, livemode: boolean }>
  sync: (ctx: PullContext) => Promise<PullResult>
  /** Minutes between full runs once up to date. Default 60. */
  everyMinutes?: number
}
