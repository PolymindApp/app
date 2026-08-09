import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import { longPressDrag, longPressDrop } from './directives/longPressDrag'
import { api } from './lib/api'
import router from './router'
import { vuetify } from './plugins/vuetify'
import { installAndroidFocusAutoScroll } from './services/androidFocusAutoScroll'
import { preloadIntervalCueAudio } from './services/intervalCues'
import { installFlashcardNotificationRouting } from './services/flashcardNotificationRouting'
import { installIntervalNotificationRouting } from './services/intervalNotificationRouting'
import { installTrackingNotificationRouting } from './services/trackingReminders'
import { startOfflineSync } from './services/offlineSync'
import {
  readAndroidRoute,
  rememberAndroidRoute,
} from './services/androidRoutePersistence'
import './styles/main.scss'

const nativePlatform = Capacitor.getPlatform()

void preloadIntervalCueAudio().catch(() => {
  // Cue audio is best-effort and can retry when an interval starts.
})

if (nativePlatform === 'android') {
  document.documentElement.classList.add('platform-android')
} else if (nativePlatform === 'ios') {
  document.documentElement.classList.add('platform-ios')
}

const app = createApp(App)
  .use(createPinia())
  .use(router)
  .use(vuetify)
  .directive('long-press-drag', longPressDrag)
  .directive('long-press-drop', longPressDrop)

if (
  nativePlatform === 'android'
  && api.authStore.hasLocalSession
  && window.location.pathname === '/'
) {
  const savedRoute = readAndroidRoute(router)
  if (savedRoute) void router.replace(savedRoute)
}

app.mount('#app')
void startOfflineSync()

if (nativePlatform === 'android') {
  installAndroidFocusAutoScroll()
  void router.isReady().then(() => {
    void installIntervalNotificationRouting(router)
    void installFlashcardNotificationRouting(router)
    void installTrackingNotificationRouting(router)
    rememberAndroidRoute(router.currentRoute.value)
    router.afterEach((to) => rememberAndroidRoute(to))

    return NativeApp.addListener('backButton', () => {
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
    })
  })
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
