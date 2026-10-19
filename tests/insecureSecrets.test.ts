import { describe, expect, test } from 'bun:test'
import { insecureSecrets } from '../server/utils/insecureSecrets'

describe('insecureSecrets', () => {
  test('flags the placeholders from .env.example', () => {
    expect(insecureSecrets({ PARSE_MASTER_KEY: 'change-me-master', MEILI_MASTER_KEY: 'a'.repeat(32) })).toEqual(['PARSE_MASTER_KEY'])
  })

  test('passes real values and unset ones', () => {
    expect(insecureSecrets({ PARSE_MASTER_KEY: 'f3a9c1', BUGSINK_SECRET_KEY: undefined })).toEqual([])
  })
})
