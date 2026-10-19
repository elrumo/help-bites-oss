// Providers offered in Settings → AI. All speak the OpenAI chat-completions
// protocol (Anthropic and Gemini through their compatibility layers), so a
// provider is just an endpoint plus a key; `models` only seeds suggestions.
export type AiProviderPreset = { kind: string, label: string, endpoint: string, models: string[] }

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { kind: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'] },
  { kind: 'anthropic', label: 'Anthropic', endpoint: 'https://api.anthropic.com/v1', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] },
  { kind: 'google', label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
  { kind: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash'] },
  { kind: 'mistral', label: 'Mistral', endpoint: 'https://api.mistral.ai/v1', models: ['mistral-small-latest', 'mistral-large-latest'] },
  { kind: 'groq', label: 'Groq', endpoint: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  { kind: 'xai', label: 'xAI', endpoint: 'https://api.x.ai/v1', models: ['grok-4', 'grok-3-mini'] },
  { kind: 'deepseek', label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { kind: 'custom', label: 'Custom (OpenAI-compatible)', endpoint: '', models: [] }
]
