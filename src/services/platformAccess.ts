import { Capacitor } from '@capacitor/core'

export function isNativeAndroidOrIosApp(
  platform = Capacitor.getPlatform(),
  native = Capacitor.isNativePlatform(),
) {
  return native && (platform === 'android' || platform === 'ios')
}
