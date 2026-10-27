import { describe, expect, test } from 'bun:test'
import { imageAllowed, imageLink } from '../shared/markdownImages'
import { uploadsOrigin } from '../server/utils/uploadsOrigin'

const origins = { self: 'https://help.example.com', uploads: 'https://files.example.com' }

describe('images in operator-visible Markdown', () => {
  test('the panel, the uploads storage and small inline images load', () => {
    for (const ok of ['/uploads/a.png', 'https://help.example.com/x.png', 'https://files.example.com/p1/a.png', 'data:image/png;base64,iVBORw0KGgo=']) expect(imageAllowed(ok, origins)).toBe(true)
  })

  test('any other address does not', () => {
    for (const bad of ['https://attacker.example/p.png?d=secret', '//attacker.example/p.png', '/\\attacker.example/p.png', 'https://files.example.com.attacker.example/a.png', 'https://help.example.com@attacker.example/a.png', 'http://files.example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'javascript:alert(1)', 'ftp://files.example.com/a.png', '', null, undefined]) expect(imageAllowed(bad, origins)).toBe(false)
  })

  test('an unknown uploads origin allows nothing remote', () => {
    expect(imageAllowed('https://files.example.com/a.png', { self: origins.self, uploads: '' })).toBe(false)
    expect(imageAllowed('https://anything.example/a.png', { self: '', uploads: '' })).toBe(false)
  })

  test('a blocked image can be offered as a link, over http(s) only', () => {
    expect(imageLink('https://attacker.example/p.png?d=1')).toBe('https://attacker.example/p.png?d=1')
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', '', null]) expect(imageLink(bad)).toBe('')
  })

  test('the uploads origin comes from S3_PUBLIC_URL', () => {
    expect(uploadsOrigin({ S3_PUBLIC_URL: 'https://bucket.s3.eu-west-1.amazonaws.com/' })).toBe('https://bucket.s3.eu-west-1.amazonaws.com')
    expect(uploadsOrigin({ S3_PUBLIC_URL: 'http://localhost:9000/help-bites' })).toBe('http://localhost:9000')
    expect(uploadsOrigin({ S3_PUBLIC_URL: 'ftp://x' })).toBe('')
    expect(uploadsOrigin({})).toBe('')
  })
})
