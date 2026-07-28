import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import router from './router'
import { vuetify } from './plugins/vuetify'
import './styles/main.scss'

if (Capacitor.getPlatform() === 'android') {
  document.documentElement.classList.add('platform-android')
}

createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app')

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
