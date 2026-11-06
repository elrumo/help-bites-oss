import { afterAll, afterEach, expect, test } from 'bun:test'
import { readJsonCmsUpload } from '../server/utils/cmsUpload'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const local = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname
    if (path === '/img/hero.png') return new Response(PNG)
    if (path === '/moved') return new Response(null, { status: 302, headers: { location: '/img/hero.png' } })
    return new Response('nope', { status: 404 })
  }
})
const base = `http://127.0.0.1:${local.port}`
const env = { ...process.env }
afterEach(() => { process.env = { ...env } })
afterAll(() => local.stop(true))

test('base64: the bytes and the text fields come through', async () => {
  const { fields, file } = await readJsonCmsUpload({ project: 'p1', contentBase64: PNG.toString('base64'), filename: 'a.png', alt: 'Hero', compress: true, ignored: 'x' })
  expect(file.data.equals(PNG)).toBe(true)
  expect(file.filename).toBe('a.png')
  expect(fields).toEqual({ project: 'p1', alt: 'Hero', compress: 'true' })
})

test('exactly one source, and real base64', async () => {
  await expect(readJsonCmsUpload({ project: 'p1' })).rejects.toMatchObject({ statusCode: 400 })
  await expect(readJsonCmsUpload({ project: 'p1', contentBase64: 'aGk=', url: `${base}/img/hero.png` })).rejects.toMatchObject({ statusCode: 400 })
  await expect(readJsonCmsUpload({ project: 'p1', contentBase64: 'not base64!' })).rejects.toMatchObject({ statusCode: 400 })
})

test('url: downloaded, named from the path; errors and redirects refused', async () => {
  process.env.ALLOW_PRIVATE_NETWORK = '1'
  const { file } = await readJsonCmsUpload({ project: 'p1', url: `${base}/img/hero.png` })
  expect(file.data.equals(PNG)).toBe(true)
  expect(file.filename).toBe('hero.png')
  await expect(readJsonCmsUpload({ project: 'p1', url: `${base}/missing.png` })).rejects.toMatchObject({ statusCode: 502 })
  await expect(readJsonCmsUpload({ project: 'p1', url: `${base}/moved` })).rejects.toMatchObject({ statusCode: 502 })
})

test('url: private addresses are refused unless the deployment allows them', async () => {
  delete process.env.ALLOW_PRIVATE_NETWORK
  await expect(readJsonCmsUpload({ project: 'p1', url: `${base}/img/hero.png` })).rejects.toMatchObject({ statusCode: 400 })
  await expect(readJsonCmsUpload({ project: 'p1', url: 'file:///etc/passwd' })).rejects.toMatchObject({ statusCode: 400 })
})
