// The keys .env.example ships as `change-me-*`. Running production with one
// means anyone who has read the repository holds the Parse master key.
const CHECKED = ['PARSE_MASTER_KEY', 'MEILI_MASTER_KEY'] as const

export function insecureSecrets(env: Record<string, string | undefined>): string[] {
  return CHECKED.filter(name => /^change-?me/i.test(env[name] ?? ''))
}
