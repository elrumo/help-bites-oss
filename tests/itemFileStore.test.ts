import { expect, mock, test } from 'bun:test'
import { createError } from 'h3'

// storeItemFile against a fake bucket: what is kept, under which type, and what is refused.
const puts: { key: string, headers: Record<string, string> }[] = []
mock.module('minio', () => ({
  Client: class {
    bucketExists = async () => true
    setBucketPolicy = async () => {}
    putObject = async (_bucket: string, key: string, _data: Buffer, _size: number, headers: Record<string, string>) => { puts.push({ key, headers }) }
  }
}))
Object.assign(globalThis, { createError, workspaceIdOfProject: async () => 'w1', reserveUsage: async () => {}, chargeUsage: async () => {} })
Object.assign(process.env, { S3_ENDPOINT: 'localhost', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's', S3_BUCKET: 'b', S3_PUBLIC_URL: 'https://cdn.example' })
const { storeItemFile } = await import('../server/utils/s3')

const XMP = Buffer.from('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta><?xpacket end="w"?>')

test('an XMP sidecar is kept and served as a download', async () => {
  const stored = await storeItemFile({ filename: 'IMG_0001.xmp', data: XMP }, 'p1', 'u1')
  expect(stored).toMatchObject({ name: 'IMG_0001.xmp', mime: 'application/octet-stream', size: XMP.length })
  expect(stored.url).toMatch(/^https:\/\/cdn\.example\/p1\/u1\/[\w-]+\.bin$/)
  expect(puts.at(-1)!.headers['Content-Disposition']).toStartWith('attachment')
})

test('programs and scripts are refused, by name or by bytes', async () => {
  await expect(storeItemFile({ filename: 'setup.exe', data: XMP }, 'p1', 'u1')).rejects.toMatchObject({ statusCode: 415 })
  await expect(storeItemFile({ filename: 'notes.xmp', data: Buffer.from('#!/bin/sh\nrm -rf /') }, 'p1', 'u1')).rejects.toMatchObject({ statusCode: 415 })
})
