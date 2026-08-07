import { isAndroidOrIosClient } from '@/services/platformAccess'

describe('platform access', () => {
  it('recognizes native Android and iOS clients', () => {
    expect(isAndroidOrIosClient('android', '', 0)).toBe(true)
    expect(isAndroidOrIosClient('ios', '', 0)).toBe(true)
  })

  it('recognizes Android and iOS web browsers', () => {
    expect(isAndroidOrIosClient('web', 'Mozilla/5.0 (Linux; Android 16)', 5)).toBe(true)
    expect(isAndroidOrIosClient('web', 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)', 5)).toBe(true)
  })

  it('recognizes an iPad using a desktop browser identity', () => {
    expect(isAndroidOrIosClient('web', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5)).toBe(true)
  })

  it('keeps desktop browsers on the desktop experience', () => {
    expect(isAndroidOrIosClient('web', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0)).toBe(false)
    expect(isAndroidOrIosClient('web', 'Mozilla/5.0 (X11; Linux x86_64)', 0)).toBe(false)
  })
})
