import type { CapacitorConfig } from '@capacitor/cli'

const nativeAppId = process.argv.includes('ios')
  ? 'app.polymind.ios'
  : 'app.polymind.android'

const config: CapacitorConfig = {
  appId: nativeAppId,
  appName: 'Polymind',
  webDir: 'dist',
  plugins: {
    BackgroundRunner: {
      label: 'app.polymind.sync',
      src: 'runners/background.js',
      event: 'backgroundSync',
      repeat: true,
      interval: 15,
      autoStart: true,
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
    },
  },
}

export default config
