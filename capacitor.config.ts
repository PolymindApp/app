import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

const nativeAppId = process.argv.includes('ios')
  ? 'app.backontrack.ios'
  : 'app.backontrack.android'

const config: CapacitorConfig = {
  appId: nativeAppId,
  appName: 'BackOnTrack',
  webDir: 'dist',
  plugins: {
    BackgroundRunner: {
      label: 'app.backontrack.sync',
      src: 'runners/background.js',
      event: 'backgroundSync',
      repeat: true,
      interval: 15,
      autoStart: true,
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
    },
  },
}

export default config
