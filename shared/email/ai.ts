// The AI designer's two tiers; `model` is the name the LiteLLM gateway knows.
export const EMAIL_AI_TIERS = {
  high: { model: 'openai/mimo-v2.6-flash', label: 'High', hint: 'Fast. Good for edits and copy.' },
  ultra: { model: 'openai/mimo-v2.6-pro', label: 'Ultra', hint: 'Strongest. New designs and big rewrites.' }
} as const

export type EmailAiTier = keyof typeof EMAIL_AI_TIERS

export function emailAiTier(value: unknown): EmailAiTier {
  return value === 'ultra' ? 'ultra' : 'high'
}

/** Room for one whole document in a single tool call: converting an email writes it all at once. */
export const EMAIL_AI_MAX_OUTPUT_TOKENS = 16_384
