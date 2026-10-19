import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { classifyAddress } from '../server/utils/outbound'
import { openSealedSecret, readLinkToken, sealSecret, signLinkToken } from '../server/utils/secrets'
import { readSourceConfig, sourceInputs } from '../server/utils/contactSources'
import { parseQueryString, parseWhere } from '../server/utils/sources/parse'
import { postgresPageQuery } from '../server/utils/sources/postgres'
import { decodeFirestoreValue, firestoreQuery, serviceAccountJwt, valueAt } from '../server/utils/sources/firestore'

process.env.HELPBITES_SECRET = 'test-secret-that-is-at-least-32-characters-long'

const statusOf = (fn: () => unknown) => {
  try { fn() } catch (error) { return (error as { statusCode?: number }).statusCode }
  return 0
}

describe('secrets', () => {
  test('sealed credentials open again and nowhere else', () => {
    const sealed = sealSecret('postgres://u:p@db.example.com/app')
    expect(sealed).not.toContain('postgres')
    expect(openSealedSecret(sealed)).toBe('postgres://u:p@db.example.com/app')
    expect(sealSecret('x')).not.toBe(sealSecret('x'))
    const [v, iv, tag, data] = sealed.split('.')
    const flipped = (data![0] === 'A' ? 'B' : 'A') + data!.slice(1)
    expect(statusOf(() => openSealedSecret([v, iv, tag, flipped].join('.')))).toBe(500)
  })

  test('link tokens are per purpose and tamper-proof', () => {
    const token = signLinkToken('unsubscribe', 'c_1:news')
    expect(readLinkToken('unsubscribe', token)).toBe('c_1:news')
    expect(readLinkToken('confirm', token)).toBeNull()
    expect(readLinkToken('unsubscribe', `${Buffer.from('c_2').toString('base64url')}.${token.split('.')[1]}`)).toBeNull()
    expect(readLinkToken('unsubscribe', 'garbage')).toBeNull()
  })

  test('no root secret, no sealing', () => {
    const saved = process.env.HELPBITES_SECRET
    process.env.HELPBITES_SECRET = 'short'
    expect(statusOf(() => sealSecret('x'))).toBe(503)
    process.env.HELPBITES_SECRET = saved
  })
})

describe('outbound addresses', () => {
  test('metadata and link-local are always blocked; private is its own class', () => {
    expect(classifyAddress('169.254.169.254')).toBe('blocked')
    expect(classifyAddress('0.0.0.0')).toBe('blocked')
    expect(classifyAddress('fe80::1')).toBe('blocked')
    expect(classifyAddress('fd00:ec2::254')).toBe('blocked')
    expect(classifyAddress('::ffff:169.254.169.254')).toBe('blocked')
    expect(classifyAddress('10.0.0.5')).toBe('private')
    expect(classifyAddress('172.20.1.1')).toBe('private')
    expect(classifyAddress('192.168.1.1')).toBe('private')
    expect(classifyAddress('127.0.0.1')).toBe('private')
    expect(classifyAddress('::1')).toBe('private')
    expect(classifyAddress('100.100.1.1')).toBe('private')
    expect(classifyAddress('172.32.0.1')).toBe('public')
    expect(classifyAddress('8.8.8.8')).toBe('public')
    expect(classifyAddress('2606:4700::1111')).toBe('public')
  })

  test('IPv4 inside IPv6 is judged as the IPv4 address, in the hex form URLs normalize to', () => {
    // new URL('http://[::ffff:169.254.169.254]/').hostname === '[::ffff:a9fe:a9fe]'
    expect(classifyAddress(new URL('http://[::ffff:169.254.169.254]/').hostname)).toBe('blocked')
    expect(classifyAddress('[::ffff:a9fe:a9fe]')).toBe('blocked')
    expect(classifyAddress('::ffff:7f00:1')).toBe('private')
    expect(classifyAddress('::ffff:ac12:3')).toBe('private')
    expect(classifyAddress('::7f00:1')).toBe('private')
    expect(classifyAddress('::127.0.0.1')).toBe('private')
    expect(classifyAddress('64:ff9b::a9fe:a9fe')).toBe('blocked')
    expect(classifyAddress('64:ff9b::10.0.0.1')).toBe('private')
    expect(classifyAddress('::ffff:808:808')).toBe('public')
    expect(classifyAddress('::')).toBe('blocked')
    expect(classifyAddress('::1')).toBe('private')
  })
})

const mapping = { externalId: 'objectId', email: 'email', name: 'username', attributes: { plan: 'billing.plan' } }

describe('Parse source', () => {
  test('continues after the cursor, ordered, and only asks for mapped keys', () => {
    expect(parseWhere({})).toEqual({})
    expect(parseWhere({ updated: '2026-01-01T00:00:00.000Z', id: 'abc' })).toEqual({
      $or: [{ updatedAt: { $gt: { __type: 'Date', iso: '2026-01-01T00:00:00.000Z' } } }, { updatedAt: { __type: 'Date', iso: '2026-01-01T00:00:00.000Z' }, objectId: { $gt: 'abc' } }]
    })
    const config = readSourceConfig('parse', { serverUrl: 'https://api.example.com/parse/', appId: 'app', className: '_User', mapping })
    expect(config).toMatchObject({ serverUrl: 'https://api.example.com/parse', idField: 'objectId', updatedField: 'updatedAt' })
    const qs = new URLSearchParams(parseQueryString(config, {}, 500).split('?')[1])
    expect(qs.get('order')).toBe('updatedAt,objectId')
    expect(qs.get('keys')).toBe('objectId,updatedAt,email,username,billing')
    expect(statusOf(() => readSourceConfig('parse', { serverUrl: 'ftp://x', appId: 'a', className: 'bad class', mapping }))).toBe(400)
  })
})

describe('Postgres source', () => {
  const base = { table: 'public.users', idField: 'id', idType: 'integer', mapping: { email: 'email', name: 'full_name', attributes: { plan: 'plan' } } }

  test('incremental: (updated, id) after the cursor, in their own types', () => {
    const config = readSourceConfig('postgres', { ...base, updatedField: 'updated_at' })
    expect(postgresPageQuery(config, {}, 500)).toEqual({
      text: 'SELECT "id"::text AS "__id", "updated_at"::text AS "__updated", "email", "full_name", "plan" FROM "public"."users" ORDER BY "updated_at", "id" LIMIT 500',
      params: []
    })
    expect(postgresPageQuery(config, { updated: '2026-01-01 10:00:00.123456+00', id: '42' }, 500)).toEqual({
      text: 'SELECT "id"::text AS "__id", "updated_at"::text AS "__updated", "email", "full_name", "plan" FROM "public"."users" WHERE ("updated_at", "id") > ($1::timestamptz, $2::integer) ORDER BY "updated_at", "id" LIMIT 500',
      params: ['2026-01-01 10:00:00.123456+00', '42']
    })
  })

  test('full scan by id; an exotic id type is compared as text', () => {
    const config = readSourceConfig('postgres', { ...base, idType: 'USER-DEFINED' })
    expect(postgresPageQuery(config, { id: 'x' }, 100).text).toBe('SELECT "id"::text AS "__id", "email", "full_name", "plan" FROM "public"."users" WHERE "id"::text > $1::text ORDER BY "id"::text LIMIT 100')
  })

  test('nothing typed into the form becomes SQL', () => {
    expect(statusOf(() => readSourceConfig('postgres', { ...base, table: 'users; drop table users' }))).toBe(400)
    expect(statusOf(() => readSourceConfig('postgres', { ...base, idField: 'id"--' }))).toBe(400)
    expect(statusOf(() => readSourceConfig('postgres', { ...base, updatedField: 'a b' }))).toBe(400)
    const config = readSourceConfig('postgres', { ...base, mapping: { email: 'email', attributes: { x: 'a.b' } } })
    // A dotted (JSON) path reads its top-level column; nothing else is selected.
    expect(postgresPageQuery(config, {}, 10).text).toBe('SELECT "id"::text AS "__id", "email", "a" FROM "public"."users" ORDER BY "id" LIMIT 10')
  })
})

describe('Firestore source', () => {
  test('values decode to plain JSON', () => {
    expect(decodeFirestoreValue({ mapValue: { fields: { n: { integerValue: '3' }, t: { booleanValue: true }, a: { arrayValue: { values: [{ stringValue: 'x' }] } }, z: { nullValue: null } } } }))
      .toEqual({ n: 3, t: true, a: ['x'], z: null })
    expect(valueAt({ profile: { mapValue: { fields: { seen: { timestampValue: '2026-01-01T00:00:00.123456Z' } } } } }, 'profile.seen')).toEqual({ timestampValue: '2026-01-01T00:00:00.123456Z' })
  })

  test('the query selects mapped fields and starts after the cursor document', () => {
    const config = readSourceConfig('firestore', { collection: 'users', updatedField: 'updatedAt', mapping: { externalId: 'id', email: 'email', attributes: { plan: 'plan' } } })
    const account = { client_email: 'x@y.iam.gserviceaccount.com', private_key: '', project_id: 'demo' }
    const cursor = { id: 'projects/demo/databases/(default)/documents/users/u9', value: { timestampValue: '2026-01-01T00:00:00.123456789Z' } }
    expect(firestoreQuery(config, account, cursor, 500).structuredQuery).toEqual({
      from: [{ collectionId: 'users' }],
      select: { fields: [{ fieldPath: 'id' }, { fieldPath: 'email' }, { fieldPath: 'plan' }, { fieldPath: 'updatedAt' }, { fieldPath: '__name__' }] },
      orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      startAt: { values: [{ timestampValue: '2026-01-01T00:00:00.123456789Z' }, { referenceValue: cursor.id }], before: false },
      limit: 500
    })
  })

  test('the service-account JWT is RS256 over the datastore scope', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwt = serviceAccountJwt({ client_email: 'sa@demo.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), project_id: 'demo' }, 1_800_000_000)
    const [head, claims, sig] = jwt.split('.')
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({ iss: 'sa@demo.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600 })
    expect(createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, sig!, 'base64url')).toBe(true)
  })
})

describe('sync consent', () => {
  test('an asserted source subscribes only rows that say nothing themselves', () => {
    const config = readSourceConfig('parse', { serverUrl: 'https://x.io/parse', appId: 'a', className: 'U', mapping: { email: 'email' }, consent: 'subscribed' })
    expect(sourceInputs(config, [{ email: 'a@x.io' }, { name: 'no email' }])).toEqual({ inputs: [{ email: 'a@x.io', subscription: 'subscribed' }], skipped: 1 })
    const own = readSourceConfig('parse', { serverUrl: 'https://x.io/parse', appId: 'a', className: 'U', mapping: { email: 'email', subscribed: 'optIn' }, consent: 'subscribed' })
    expect(sourceInputs(own, [{ email: 'a@x.io', optIn: false }]).inputs).toEqual([{ email: 'a@x.io', subscription: 'unsubscribed' }])
  })
})
