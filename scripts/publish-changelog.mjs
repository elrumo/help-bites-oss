// Publishes CHANGELOG.md's section for a version to a HelpBites project's public changelog: HelpBites keeps its own
// changelog on HelpBites. The release workflow runs it on every tag; run it by hand to backfill (docs/RELEASING.md).
//
//   HELPBITES_URL=https://helpbites.app HELPBITES_ADMIN_KEY=ak_… HELPBITES_PROJECT=<id or pk_…> \
//     bun scripts/publish-changelog.mjs [--version 0.2.0] [--draft] [--dry-run]
//
// A release is created for the version (or reused), each bullet becomes an entry in it, and the release is published
// (--draft leaves it unpublished). Safe to run again: bullets whose title the release already has are skipped.
// Without HELPBITES_URL / HELPBITES_ADMIN_KEY / HELPBITES_PROJECT it does nothing, so forks' release builds still pass.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

/**
 * CHANGELOG.md as `[{ version, date, summary, entries: [{ title, body, tag }] }]`, newest first. A section is
 * `## <version or Unreleased>` with an optional ` — YYYY-MM-DD`; text before its first bullet is the summary, and each
 * bullet (with its indented continuation lines) is an entry, titled by its leading `**bold**` text.
 */
export function parseChangelog(text) {
  const sections = []
  let bullet = null
  const close = () => {
    if (!bullet) return
    const raw = bullet.join(' ').replace(/\s+/g, ' ').trim()
    const bold = /^\*\*(.+?)\*\*/.exec(raw)
    // No bold lead: "Name: what it does" titles by the name, else the first sentence (a clause at most 120 characters).
    const colon = !bold && /^([^:*`]{3,80}):\s+(.+)$/.exec(raw)
    const sentence = /^(.{1,120}?[.!?])(\s|$)/.exec(raw)
    const title = (bold ? bold[1] : colon ? colon[1] : sentence ? sentence[1] : raw.slice(0, 120).replace(/\s\S*$/, '')).replace(/\*\*/g, '').replace(/[.:\s]+$/, '')
    // The sentence stays in the body when it was the title.
    const body = bold ? raw.slice(bold[0].length).replace(/^\s*[:.-]?\s*/, '') : colon ? colon[2] : raw
    sections.at(-1).entries.push({ title: title.slice(0, 200), body, tag: tagOf(raw) })
    bullet = null
  }
  for (const line of text.split('\n')) {
    const heading = /^## (.+?)\s*$/.exec(line)
    if (heading) {
      close()
      const [, version, date] = /^(\S+)(?:.*?(\d{4}-\d{2}-\d{2}))?/.exec(heading[1])
      sections.push({ version, date: date || '', summary: '', entries: [] })
    } else if (!sections.length) continue
    else if (/^- /.test(line)) { close(); bullet = [line.slice(2)] }
    else if (bullet && /^\s+\S/.test(line)) bullet.push(line.trim())
    else if (!line.trim()) close()
    else if (!sections.at(-1).entries.length && !line.startsWith('#')) sections.at(-1).summary += `${sections.at(-1).summary ? ' ' : ''}${line.trim()}`
  }
  close()
  return sections
}

/** The entry's tag, guessed from its words: breaking, fix and removed are called out, anything else is new. */
export function tagOf(raw) {
  if (/\*\*breaking/i.test(raw)) return 'breaking'
  if (/^\**(fix|fixes|fixed)\b/i.test(raw)) return 'fix'
  if (/^\**(remove|removed|removes)\b/i.test(raw)) return 'removed'
  return 'new'
}

async function main() {
  const { values } = parseArgs({ options: { version: { type: 'string' }, draft: { type: 'boolean' }, 'dry-run': { type: 'boolean' } } })
  const root = new URL('..', import.meta.url)
  const version = values.version || JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version
  const section = parseChangelog(readFileSync(new URL('CHANGELOG.md', root), 'utf8')).find(s => s.version === version)
  if (!section?.entries.length) throw new Error(`CHANGELOG.md has no section "## ${version}" with entries. Move Unreleased under the new version first.`)

  if (values['dry-run']) {
    console.log(`${version}${section.date ? ` (${section.date})` : ''}: ${section.entries.length} entries`)
    for (const e of section.entries) console.log(`  [${e.tag}] ${e.title}`)
    return
  }
  const url = String(process.env.HELPBITES_URL || '').replace(/\/+$/, '')
  const key = process.env.HELPBITES_ADMIN_KEY
  const ref = process.env.HELPBITES_PROJECT
  if (!url || !key || !ref) return console.log('HELPBITES_URL, HELPBITES_ADMIN_KEY and HELPBITES_PROJECT are not all set: not publishing the changelog.')

  const api = async (path, body) => {
    const res = await fetch(`${url}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${path}: ${res.status} ${json.statusMessage || json.message || ''}`.trim())
    return json
  }
  const { projects } = await api('/v1/admin/projects')
  const project = projects.find(p => p.id === ref || p.publicKey === ref)
  if (!project) throw new Error(`No project "${ref}" for that key.`)
  const q = `project=${encodeURIComponent(project.id)}`

  const { releases } = await api(`/v1/admin/changelog/releases?${q}`)
  const release = releases.find(r => r.version === version) || (await api(`/v1/admin/changelog/releases?${q}`, {
    version,
    title: `HelpBites ${version}`,
    summary: section.summary || undefined,
    ...(section.date ? { publishedAt: new Date(`${section.date}T12:00:00Z`).toISOString() } : {})
  })).release
  const { entries: have } = await api(`/v1/admin/changelog/entries?${q}&release=${encodeURIComponent(release.id)}`)
  const titles = new Set(have.map(e => e.title))
  const fresh = section.entries.filter(e => !titles.has(e.title))
  // The batch takes 50 at a time; entries start as drafts and go public with the release.
  for (let i = 0; i < fresh.length; i += 50) {
    const { failed } = await api(`/v1/admin/changelog/entries/batch?${q}`, { entries: fresh.slice(i, i + 50).map(e => ({ ...e, releaseId: release.id, status: 'draft' })) })
    if (failed?.length) throw new Error(`Could not create ${failed.length} entries: ${failed.map(f => `#${f.index} ${f.message}`).join('; ')}`)
  }
  if (!values.draft) await api(`/v1/admin/changelog/releases/${release.id}/publish`, {})
  console.log(`${version}: ${fresh.length} entries added (${section.entries.length - fresh.length} already there), release ${values.draft ? 'left as a draft' : 'published'}.`)
}

if (import.meta.main) main().catch((err) => { console.error(err.message); process.exit(1) })
