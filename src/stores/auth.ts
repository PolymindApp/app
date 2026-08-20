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

export class UnsyncedChangesError extends Error {
  constructor(readonly changeCount?: number) {
    super(changeCount === undefined
      ? 'Local changes could not be checked before sign-out.'
      : `${changeCount} local change${changeCount === 1 ? '' : 's'} could not be synchronized.`)
    this.name = 'UnsyncedChangesError'
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(api.authStore.record)
  const loading = ref(false)
  const accountLoading = ref(false)
  const passwordLoading = ref(false)
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
      return await api.registerAccount(
        name,
        email,
        password,
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto',
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to create your account.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function verifyEmail(token: string) {
    loading.value = true
    error.value = ''
    try {
      return await api.verifyEmail(token)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to confirm your email.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function resendEmailVerification(email: string) {
    loading.value = true
    error.value = ''
    try {
      return await api.resendEmailVerification(email)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to resend the confirmation email.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function requestPasswordReset(email: string) {
    loading.value = true
    error.value = ''
    try {
      return await api.requestPasswordReset(email)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to request a password reset.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function resetPassword(token: string, password: string) {
    loading.value = true
    error.value = ''
    try {
      return await api.resetPassword(token, password)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to reset your password.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function changePassword(currentPassword: string, password: string) {
    passwordLoading.value = true
    error.value = ''
    try {
      return await api.changePassword(currentPassword, password)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to change your password.'
      throw cause
    } finally {
      passwordLoading.value = false
    }
  }

  function clearError() {
    error.value = ''
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
    const previous = user.value
    if (previous) user.value = { ...previous, name: name.trim() }
    try {
      await api.updateAccount(name)
    } catch (cause) {
      user.value = previous
      error.value = cause instanceof Error ? cause.message : 'Unable to update your name.'
      throw cause
    } finally {
      accountLoading.value = false
    }
  }

  async function updateAvatar(image: Blob) {
    avatarLoading.value = true
    error.value = ''
    const previous = user.value
    const preview = URL.createObjectURL(image)
    if (previous) user.value = { ...previous, avatar: preview }
    try {
      await api.updateAvatar(image)
    } catch (cause) {
      user.value = previous
      error.value = cause instanceof Error ? cause.message : 'Unable to update your avatar.'
      throw cause
    } finally {
      URL.revokeObjectURL(preview)
      avatarLoading.value = false
    }
  }

  async function removeAvatar() {
    avatarLoading.value = true
    error.value = ''
    const previous = user.value
    if (previous) user.value = { ...previous, avatar: '' }
    try {
      await api.removeAvatar()
    } catch (cause) {
      user.value = previous
      error.value = cause instanceof Error ? cause.message : 'Unable to remove your avatar.'
      throw cause
    } finally {
      avatarLoading.value = false
    }
  }

  async function logout(options: { discardUnsynced?: boolean } = {}) {
    const accountId = api.authStore.record?.id || ''
    logoutLoading.value = true
    error.value = ''
    try {
      if (accountId && !options.discardUnsynced) {
        let pending: number
        try {
          pending = await flushBeforeSignOut(accountId)
        } catch {
          throw new UnsyncedChangesError()
        }
        if (pending > 0) throw new UnsyncedChangesError(pending)
      }

      api.authStore.clear()

      if (accountId) {
        const cleanup = await Promise.allSettled([
          clearBackgroundSyncStage(),
          eraseLocalAccount(accountId),
          clearOfflineMediaCache(),
        ])
        if (cleanup.some(result => result.status === 'rejected')) {
          error.value = 'You are signed out, but some offline data could not be removed from this device.'
        }
      }
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
    passwordLoading,
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
    verifyEmail,
    resendEmailVerification,
    requestPasswordReset,
    resetPassword,
    changePassword,
    clearError,
    registerPasskey,
    disconnectPasskeys,
    updateName,
    updateAvatar,
    removeAvatar,
    logout,
  }
})
