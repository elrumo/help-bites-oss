// The workspace overview, the page the panel and the native app open on: a card
// per project, the latest unread conversations, and revenue across every project
// with Stripe connected. Built by server/utils/overview.ts; shared by the server,
// the panel and the demo. The native app's copy is Features/Overview/OverviewModels.swift.

import type { RevenueRange } from './stripe'

/** How many unread conversations the overview lists. */
export const OVERVIEW_UNREAD_LIMIT = 8

export type OverviewProject = {
  id: string
  name: string
  /** Conversations in an open or pending status. */
  open: number
  /** Conversations with unread customer messages, outside the archive. */
  unread: number
  /** Open error reports. */
  errors: number
}

export type OverviewUnread = {
  conversationId: string
  projectId: string
  /** The customer's name and email; either can be blank. */
  name: string
  email: string
  subject: string
  preview: string
  /** Unread customer messages in it. */
  unread: number
  at: string
}

/**
 * Revenue side by side. Each project counts in its own currency, the one its
 * Revenue tab totals in, so a project's numbers here match that tab. Amounts are
 * in major units (19.99). `previousNet` is the period before this one and
 * `change` the move from it as a fraction (0.12 is 12% up); both are null for
 * all time, and `change` is null when the period before had nothing.
 */
export type WorkspaceRevenue = {
  range: RevenueRange
  /** Projects with Stripe connected, synced or not. */
  connected: number
  /** One per currency, the most revenue first. */
  totals: { currency: string, net: number, previousNet: number | null, change: number | null, mrr: number, subscribers: number, months: { month: string, net: number }[] }[]
  /** Projects that have synced, the most revenue first. */
  projects: { projectId: string, currency: string, net: number, previousNet: number | null, change: number | null, mrr: number, subscribers: number, payments: number }[]
}

export type WorkspaceOverview = {
  totals: {
    /** Unread customer messages outside the archive: the inbox badge. */
    unreadMessages: number
    unread: number
    open: number
    errors: number
  }
  /** Every project, in the sidebar's order. */
  projects: OverviewProject[]
  /** The latest conversations with unread messages, newest first. */
  unread: OverviewUnread[]
  /** Null for agents: revenue is for admins and owners. */
  revenue: WorkspaceRevenue | null
}

/** The move from `previous` to `current` as a fraction, or null when there is nothing to compare with. */
export function revenueChange(current: number, previous: number | null): number | null {
  return previous ? Math.round(((current - previous) / previous) * 1000) / 1000 : null
}
