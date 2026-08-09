import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.coulombe.mom',
  appName: 'Polymind',
  webDir: 'dist',
  plugins: {
    BackgroundRunner: {
      label: 'dev.coulombe.mom.sync',
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
