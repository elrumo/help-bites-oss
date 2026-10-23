import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_REPORTS, nextReportAt, readReportFrequency, REPORT_FREQUENCIES } from '../shared/errorReports'

describe('error report schedule', () => {
  test('anything unknown is off, and off has no next run', () => {
    expect(readReportFrequency('hourly')).toBe('off')
    expect(readReportFrequency(undefined)).toBe('off')
    expect(readReportFrequency('weekly')).toBe('weekly')
    expect(nextReportAt('off', new Date())).toBeNull()
  })

  test('the next run is one interval away', () => {
    const from = new Date('2026-10-23T09:00:00Z')
    expect(nextReportAt('daily', from)!.toISOString()).toBe('2026-10-24T09:00:00.000Z')
    expect(nextReportAt('weekly', from)!.toISOString()).toBe('2026-10-30T09:00:00.000Z')
    expect(nextReportAt('monthly', from)!.toISOString()).toBe('2026-11-22T09:00:00.000Z')
    expect(MAX_REPORTS).toBe(100)
  })

  test('the native app lists the same frequencies', () => {
    const swift = readFileSync(join(import.meta.dir, '..', 'helpbites-native/App/Features/Errors/ErrorsModels.swift'), 'utf8')
    const line = swift.match(/enum ErrorReportFrequency[^\n]*\n\s*case ([^\n]+)/)![1]!
    expect(line.split(',').map(item => item.trim())).toEqual([...REPORT_FREQUENCIES])
  })
})
