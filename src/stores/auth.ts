import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import {
  createAndroidPasskey,
  getAndroidPasskey,
  PasskeyCancelledError,
} from '@/services/passkeys'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(api.authStore.record)
  const loading = ref(false)
  const passkeyLoading = ref(false)
  const error = ref('')

  api.authStore.onChange((_token, record) => {
    user.value = record
  })

  const isAuthenticated = computed(() => api.authStore.isValid)
  const firstName = computed(() => user.value?.name?.split(' ')[0] || 'You')

  async function login(email: string, password: string) {
    loading.value = true
    error.value = ''
    try {
      await api.collection('users').authWithPassword(email, password)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to sign in.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function register(name: string, email: string, password: string) {
    loading.value = true
    error.value = ''
    try {
      await api.collection('users').create({
        name,
        email,
        password,
        passwordConfirm: password,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto',
      })
      await login(email, password)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to create your account.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function loginWithPasskey() {
    passkeyLoading.value = true
    error.value = ''
    try {
      const options = await api.beginPasskeyLogin()
      const credential = await getAndroidPasskey(options.requestJson)
      await api.finishPasskeyLogin(options.ceremonyId, credential)
      return true
    } catch (cause) {
      if (cause instanceof PasskeyCancelledError) return false
      error.value = cause instanceof Error ? cause.message : 'Unable to sign in with a passkey.'
      throw cause
    } finally {
      passkeyLoading.value = false
    }
  }

  async function registerPasskey() {
    passkeyLoading.value = true
    error.value = ''
    try {
      const options = await api.beginPasskeyRegistration()
      const credential = await createAndroidPasskey(options.requestJson)
      await api.finishPasskeyRegistration(options.ceremonyId, credential)
      return true
    } catch (cause) {
      if (cause instanceof PasskeyCancelledError) return false
      error.value = cause instanceof Error ? cause.message : 'Unable to create a passkey.'
      throw cause
    } finally {
      passkeyLoading.value = false
    }
  }

  function logout() {
    api.authStore.clear()
  }

  return {
    user,
    loading,
    passkeyLoading,
    error,
    isAuthenticated,
    firstName,
    login,
    loginWithPasskey,
    register,
    registerPasskey,
    logout,
  }
})
