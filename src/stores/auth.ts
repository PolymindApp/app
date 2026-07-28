import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { pb } from '@/lib/pocketbase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(pb.authStore.record)
  const loading = ref(false)
  const error = ref('')

  pb.authStore.onChange((_token, record) => {
    user.value = record
  })

  const isAuthenticated = computed(() => pb.authStore.isValid)
  const firstName = computed(() => user.value?.name?.split(' ')[0] || 'Athlete')

  async function login(email: string, password: string) {
    loading.value = true
    error.value = ''
    try {
      await pb.collection('users').authWithPassword(email, password)
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
      await pb.collection('users').create({
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

  function logout() {
    pb.authStore.clear()
  }

  return { user, loading, error, isAuthenticated, firstName, login, register, logout }
})
