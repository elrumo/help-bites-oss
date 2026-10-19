import type { CampaignStatus } from '#shared/marketing'

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string, color: 'neutral' | 'info' | 'warning' | 'success' | 'error', icon: string }> = {
  draft: { label: 'Draft', color: 'neutral', icon: 'i-lucide-pencil-line' },
  scheduled: { label: 'Scheduled', color: 'info', icon: 'i-lucide-calendar-clock' },
  sending: { label: 'Sending', color: 'warning', icon: 'i-lucide-send' },
  paused: { label: 'Paused', color: 'neutral', icon: 'i-lucide-pause' },
  sent: { label: 'Sent', color: 'success', icon: 'i-lucide-check' },
  canceled: { label: 'Canceled', color: 'error', icon: 'i-lucide-x' }
}

export const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : '—')
