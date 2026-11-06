import { afterAll, afterEach, expect, test } from 'bun:test'
import { readJsonItemUpload } from '../server/utils/itemUpload'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const local = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname
    if (path === '/shots/Screen%20One.png') return new Response(PNG)
    if (path === '/moved') return new Response(null, { status: 302, headers: { location: '/shots/Screen%20One.png' } })
    return new Response('nope', { status: 404 })
  }
})
const base = `http://127.0.0.1:${local.port}`
const env = { ...process.env }
afterEach(() => { process.env = { ...env } })
afterAll(() => local.stop(true))

test('base64 needs a filename; exactly one source', async () => {
  const ok = await readJsonItemUpload({ filename: 'a.png', contentBase64: PNG.toString('base64') })
  expect(ok.data.equals(PNG)).toBe(true)
  await expect(readJsonItemUpload({ contentBase64: PNG.toString('base64') })).rejects.toMatchObject({ statusCode: 400 })
  await expect(readJsonItemUpload({})).rejects.toMatchObject({ statusCode: 400 })
  await expect(readJsonItemUpload({ filename: 'a.png', contentBase64: 'aGk=', url: `${base}/x` })).rejects.toMatchObject({ statusCode: 400 })
  await expect(readJsonItemUpload({ filename: 'a.png', contentBase64: 'not base64!' })).rejects.toMatchObject({ statusCode: 400 })
})

test('url: downloaded and named from the path; errors and redirects refused; private hosts refused by default', async () => {
  await expect(readJsonItemUpload({ url: `${base}/shots/Screen%20One.png` })).rejects.toBeDefined()
  process.env.ALLOW_PRIVATE_NETWORK = '1'
  const file = await readJsonItemUpload({ url: `${base}/shots/Screen%20One.png` })
  expect(file.data.equals(PNG)).toBe(true)
  expect(file.filename).toBe('Screen One.png')
  expect((await readJsonItemUpload({ url: `${base}/shots/Screen%20One.png`, filename: 'x.png' })).filename).toBe('x.png')
  await expect(readJsonItemUpload({ url: `${base}/missing.png` })).rejects.toMatchObject({ statusCode: 502 })
  await expect(readJsonItemUpload({ url: `${base}/moved` })).rejects.toMatchObject({ statusCode: 502 })
})
