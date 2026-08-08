import { isNativeAndroidOrIosApp } from '@/services/platformAccess'

describe('platform access', () => {
  it('recognizes the native Android and iOS apps', () => {
    expect(isNativeAndroidOrIosApp('android', true)).toBe(true)
    expect(isNativeAndroidOrIosApp('ios', true)).toBe(true)
  })

  it('keeps Android and iOS browsers on the web experience', () => {
    expect(isNativeAndroidOrIosApp('android', false)).toBe(false)
    expect(isNativeAndroidOrIosApp('ios', false)).toBe(false)
  })

  it('does not treat a web runtime as a native mobile app', () => {
    expect(isNativeAndroidOrIosApp('web', false)).toBe(false)
    expect(isNativeAndroidOrIosApp('web', true)).toBe(false)
  })
})
