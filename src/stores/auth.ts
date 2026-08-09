import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { eraseLocalAccount } from '@/lib/localDatabase'
import {
  clearBackgroundSyncStage,
  clearOfflineMediaCache,
  flushBeforeSignOut,
} from '@/services/offlineSync'
import {
  createAndroidPasskey,
  getAndroidPasskey,
  PasskeyCancelledError,
} from '@/services/passkeys'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(api.authStore.record)
  const loading = ref(false)
  const accountLoading = ref(false)
  const avatarLoading = ref(false)
  const passkeyLoading = ref(false)
  const error = ref('')
  const logoutLoading = ref(false)

  api.authStore.onChange((_token, record) => {
    user.value = record
  })

  const isAuthenticated = computed(() => api.authStore.hasLocalSession)
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
      error.value = cause instanceof Error ? cause.message : 'Unable to sign in with biometrics.'
      throw cause
    } finally {
      passkeyLoading.value = false
    }
  }

  async function hasRegisteredPasskey() {
    const status = await api.getPasskeyStatus()
    return status.registered
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
      error.value = cause instanceof Error ? cause.message : 'Unable to connect biometric sign-in.'
      throw cause
    } finally {
      passkeyLoading.value = false
    }
  }

  async function disconnectPasskeys() {
    passkeyLoading.value = true
    error.value = ''
    try {
      await api.removePasskeys()
    } catch (cause) {
      error.value = cause instanceof Error
        ? cause.message
        : 'Unable to disconnect biometric sign-in.'
      throw cause
    } finally {
      passkeyLoading.value = false
    }
  }

  async function updateName(name: string) {
    accountLoading.value = true
    error.value = ''
    try {
      await api.updateAccount(name)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to update your name.'
      throw cause
    } finally {
      accountLoading.value = false
    }
  }

  async function updateAvatar(image: Blob) {
    avatarLoading.value = true
    error.value = ''
    try {
      await api.updateAvatar(image)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to update your avatar.'
      throw cause
    } finally {
      avatarLoading.value = false
    }
  }

  async function removeAvatar() {
    avatarLoading.value = true
    error.value = ''
    try {
      await api.removeAvatar()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to remove your avatar.'
      throw cause
    } finally {
      avatarLoading.value = false
    }
  }

  async function logout() {
    const accountId = api.authStore.record?.id || ''
    logoutLoading.value = true
    error.value = ''
    try {
      if (accountId) {
        const pending = await flushBeforeSignOut(accountId)
        if (pending > 0) {
          throw new Error('Your unsynchronized changes are still saved on this device. Connect before signing out so they are not lost.')
        }
        await clearBackgroundSyncStage()
        await eraseLocalAccount(accountId)
        await clearOfflineMediaCache()
      }
      api.authStore.clear()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to safely sign out.'
      throw cause
    } finally {
      logoutLoading.value = false
    }
  }

  return {
    user,
    loading,
    accountLoading,
    avatarLoading,
    passkeyLoading,
    error,
    logoutLoading,
    isAuthenticated,
    firstName,
    hasRegisteredPasskey,
    login,
    loginWithPasskey,
    register,
    registerPasskey,
    disconnectPasskeys,
    updateName,
    updateAvatar,
    removeAvatar,
    logout,
  }
})
