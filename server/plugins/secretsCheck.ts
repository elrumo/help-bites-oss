// Refuse to serve production with the placeholder secrets from .env.example
// (scripts/install.sh generates real ones). ALLOW_PLACEHOLDER_SECRETS=1 skips
// the check for a throwaway trial.
export default defineNitroPlugin(() => {
  if (import.meta.prerender || process.env.NODE_ENV !== 'production' || process.env.ALLOW_PLACEHOLDER_SECRETS === '1') return
  const bad = insecureSecrets(process.env)
  if (!bad.length) return
  console.error(`[secrets] ${bad.join(', ')} still hold the "change-me" placeholder from .env.example; set real values (scripts/install.sh generates them). Refusing to start.`)
  process.exit(1)
})
