import { describe, expect, test } from 'bun:test'
import { classifyAddress } from '../server/utils/outbound'

describe('which addresses a server will connect to', () => {
  test('cloud metadata and the like are blocked, in every notation', () => {
    for (const address of [
      '169.254.169.254', '168.63.129.16', '192.0.0.192', '192.0.0.1', '0.0.0.0', '224.0.0.1', '::', 'fe80::1', 'ff02::1', 'fd00:ec2::254',
      // Site-local, 6to4, Teredo and SIIT, written long or short.
      'fec0::1', 'feff::1', '2002:7f00:1::1', '2002:a9fe:a9fe::', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:0000:4136::1',
      '::ffff:0:a9fe:a9fe', '::ffff:0:169.254.169.254', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '[fe80::1]'
    ]) expect(classifyAddress(address)).toBe('blocked')
  })

  test('the private network is private, and the rest is public', () => {
    for (const address of ['10.0.0.1', '127.0.0.1', '172.16.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd12::1', 'fc00::1', '::ffff:7f00:1', '::ffff:0:7f00:1']) expect(classifyAddress(address)).toBe('private')
    for (const address of ['8.8.8.8', '203.0.113.7', '168.63.129.17', '192.0.1.1', '192.0.2.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '2001:db8::1']) expect(classifyAddress(address)).toBe('public')
  })
})
