import type { ChangelogTag } from '#shared/changelog'

/** The chip colour of an entry's tag, in the public changelog and in the panel. */
export const CHANGELOG_TAG_CLASS: Record<ChangelogTag, string> = {
  new: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  improved: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  fix: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  removed: 'bg-stone-500/15 text-stone-700 dark:text-stone-300',
  breaking: 'bg-red-500/15 text-red-700 dark:text-red-300'
}
