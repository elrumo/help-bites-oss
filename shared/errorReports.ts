/** How often the AI triage of a project's unresolved errors runs on its own. Native copies this list (ErrorsModels.swift); tests/errorReportsNativeParity.test.ts keeps them equal. */
export const REPORT_FREQUENCIES = ['off', 'daily', 'weekly', 'monthly'] as const
export type ReportFrequency = typeof REPORT_FREQUENCIES[number]

const DAY = 24 * 60 * 60 * 1000
export const REPORT_INTERVAL_MS: Record<Exclude<ReportFrequency, 'off'>, number> = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY }

/** Reports kept per project; a new one pushes the oldest out. */
export const MAX_REPORTS = 100

export const readReportFrequency = (value: unknown): ReportFrequency => REPORT_FREQUENCIES.find(item => item === value) || 'off'

/** When the next run is due if it starts now; null while it is off. */
export function nextReportAt(frequency: ReportFrequency, from: Date): Date | null {
  return frequency === 'off' ? null : new Date(from.getTime() + REPORT_INTERVAL_MS[frequency])
}
