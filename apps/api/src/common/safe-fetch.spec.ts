import { checkUrl, isBlockedAddress, safeFetch, UnsafeUrlError } from './safe-fetch';

describe('safeFetch', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::5',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ])('treats %s as not public', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5'])('treats %s as public', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/feed.xml',
    'http://example.com:8080/feed.xml',
    'https://user:pass@example.com/feed.xml',
    'http://127.0.0.1/feed.xml',
    'http://[::1]/feed.xml',
    '/uploads/a.jpg',
  ])('refuses %s before connecting', (url) => {
    expect(() => checkUrl(url)).toThrow(UnsafeUrlError);
  });

  it('accepts a normal https link', () => {
    expect(checkUrl('https://shop.example.com/feed.xml?x=1').hostname).toBe('shop.example.com');
  });

  it('refuses a host name that resolves to a private address', async () => {
    await expect(safeFetch('http://localhost/feed.xml')).rejects.toThrow(/not public/);
  });
});
