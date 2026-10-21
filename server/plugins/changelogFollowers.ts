// A published changelog entry tells the people following the posts it answers:
// an in-process handler on the domain-event bus (server/utils/domainEvents.ts),
// so the publish itself never waits on, or fails because of, the mail.

export default defineNitroPlugin(() => {
  // The build prerenders `/` with Nitro plugins running; nothing here needs to exist then.
  if (import.meta.prerender) return
  onDomainEvent('changelog-followers', 'changelog.entry.published', notifyChangelogFollowers)
})
