import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import router from './router'
import { vuetify } from './plugins/vuetify'
import './styles/main.scss'

const nativePlatform = Capacitor.getPlatform()

if (nativePlatform === 'android') {
  document.documentElement.classList.add('platform-android')
} else if (nativePlatform === 'ios') {
  document.documentElement.classList.add('platform-ios')
}

createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app')

if (nativePlatform === 'android') {
  void router.isReady().then(() => NativeApp.addListener('backButton', () => {
    const historyState = window.history.state as { back?: unknown } | null
    if (typeof historyState?.back === 'string') {
      router.back()
      return
    }

    const backTo = router.currentRoute.value.meta.backTo
    if (typeof backTo === 'string') {
      void router.replace(backTo)
      return
    }

    void NativeApp.minimizeApp()
  }))
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
