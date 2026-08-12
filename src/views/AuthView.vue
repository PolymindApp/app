<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import { isAndroidPasskeyAvailable } from '@/services/passkeys'
import { useAuthStore } from '@/stores/auth'

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const reauthenticating = computed(() => route.query.reauth === '1' && Boolean(auth.user))
const mode = ref<'login' | 'register'>('login')
const name = ref('')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const visible = ref(false)
const confirmVisible = ref(false)
const form = ref()
const backendOffline = ref(false)
const emailField = ref<{ focus: () => void }>()
const nameField = ref<{ focus: () => void }>()
const passkeyAvailable = ref(false)
const success = ref('')
const pageError = ref('')
const registrationEmail = ref('')
const handledVerificationToken = ref('')

const pageFlow = computed(() => {
  if (route.name === 'forgot-password') return 'forgot'
  if (route.name === 'reset-password') return 'reset'
  if (route.name === 'verify-email') return 'verify'
  return 'auth'
})
const resetToken = computed(() => typeof route.query.token === 'string' ? route.query.token : '')
const cardTitle = computed(() => {
  if (pageFlow.value === 'forgot') return 'Reset your password'
  if (pageFlow.value === 'reset') return success.value ? 'Password reset' : 'Choose a new password'
  if (pageFlow.value === 'verify') {
    if (auth.loading) return 'Confirming your email'
    return success.value ? 'Email confirmed' : 'Confirm your email'
  }
  return mode.value === 'login' ? 'Welcome back' : 'Create your space'
})
const cardCopy = computed(() => {
  if (pageFlow.value === 'forgot') return 'Enter your email and we’ll send you a reset link.'
  if (pageFlow.value === 'reset') return success.value
    ? 'Your new password is ready.'
    : 'Use at least 8 characters for your new password.'
  if (pageFlow.value === 'verify') return success.value
    ? 'Your account is ready to use.'
    : 'This will only take a moment.'
  if (reauthenticating.value) return 'Sign in again to resume background synchronization.'
  return mode.value === 'login' ? 'Pick up where you left off.' : 'Create a private, synced workspace.'
})

const required = (value: string) => Boolean(value) || 'Required'
const validEmail = (value: string) => /.+@.+\..+/.test(value) || 'Enter a valid email'
const strongPassword = (value: string) => value.length >= 8 || 'Use at least 8 characters'
const matchingPassword = (value: string) => value === password.value || 'Passwords must match'

async function focusCurrentField() {
  if (!allowAutomaticFocus) return
  await nextTick()
  if (pageFlow.value === 'auth' && mode.value === 'register') nameField.value?.focus()
  else emailField.value?.focus()
}

watch(mode, async (nextMode) => {
  auth.clearError()
  pageError.value = ''
  success.value = ''
  password.value = ''
  passwordConfirm.value = ''
  if (nextMode === 'register') registrationEmail.value = ''
  await focusCurrentField()
})

watch(
  () => [route.name, route.query.token],
  async () => {
    auth.clearError()
    pageError.value = ''
    success.value = ''
    backendOffline.value = false
    registrationEmail.value = ''
    password.value = ''
    passwordConfirm.value = ''
    if (reauthenticating.value) email.value = auth.user?.email || ''
    passkeyAvailable.value = await isAndroidPasskeyAvailable()
    if (pageFlow.value === 'verify') await confirmEmail()
    else await focusCurrentField()
  },
  { immediate: true },
)

async function submit() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  backendOffline.value = false
  pageError.value = ''
  try {
    if (pageFlow.value === 'forgot') {
      const response = await auth.requestPasswordReset(email.value)
      success.value = response.message
      return
    }
    if (pageFlow.value === 'reset') {
      const response = await auth.resetPassword(resetToken.value, password.value)
      success.value = response.message
      password.value = ''
      passwordConfirm.value = ''
      return
    }
    if (mode.value === 'login') {
      await auth.login(email.value, password.value)
      await router.replace(reauthenticating.value ? String(route.query.redirect || '/tasks') : '/tasks')
      return
    }
    const response = await auth.register(name.value, email.value, password.value)
    registrationEmail.value = response.email || email.value
    success.value = response.message
    password.value = ''
    passwordConfirm.value = ''
  } catch (error) {
    backendOffline.value = error instanceof TypeError || (error instanceof Error && /fetch|network/i.test(error.message))
  }
}

async function confirmEmail() {
  const token = resetToken.value
  if (!token) {
    pageError.value = 'This confirmation link is invalid or expired.'
    return
  }
  if (handledVerificationToken.value === token) return
  handledVerificationToken.value = token
  try {
    const response = await auth.verifyEmail(token)
    success.value = response.message
  } catch (error) {
    backendOffline.value = error instanceof TypeError || (error instanceof Error && /fetch|network/i.test(error.message))
  }
}

async function resendConfirmation() {
  backendOffline.value = false
  try {
    const response = await auth.resendEmailVerification(registrationEmail.value)
    success.value = response.message
  } catch (error) {
    backendOffline.value = error instanceof TypeError || (error instanceof Error && /fetch|network/i.test(error.message))
  }
}

async function signInWithPasskey() {
  backendOffline.value = false
  try {
    if (await auth.loginWithPasskey()) await router.replace(reauthenticating.value ? String(route.query.redirect || '/tasks') : '/tasks')
  } catch (error) {
    backendOffline.value = error instanceof TypeError || (error instanceof Error && /fetch|network/i.test(error.message))
  }
}
</script>

<template>
  <v-app>
    <v-main class="auth-page app-scroll">
      <div class="auth-glow" />
      <v-container class="auth-wrap px-5">
        <section class="auth-intro">
          <div class="logo-box">
            <img src="/brand/polymind-wordmark.png" alt="Polymind" />
          </div>
          <h1 class="display-title auth-title mt-3">
            <span class="auth-title__lead">MAKE LIFE</span>
            <span class="auth-title__programmable text-secondary">PROGRAMMABLE.</span>
          </h1>
          <p class="auth-copy mt-5">
              Plan tasks and workouts, run intervals, review flashcards with audio, track habits and Health Connect progress, explore insights, and journal reflections, all in one flexible system for real life.
          </p>
        </section>

        <v-card class="auth-card pa-5 pa-sm-7" color="surface">
          <div v-if="pageFlow === 'auth' && !reauthenticating && !registrationEmail" class="d-flex ga-2 mb-6">
            <v-btn
              class="flex-grow-1"
              :variant="mode === 'login' ? 'flat' : 'text'"
              :color="mode === 'login' ? 'secondary' : undefined"
              @click="mode = 'login'"
            >
              Sign in
            </v-btn>
            <v-btn
              class="flex-grow-1"
              :variant="mode === 'register' ? 'flat' : 'text'"
              :color="mode === 'register' ? 'secondary' : undefined"
              @click="mode = 'register'"
            >
              Join Polymind
            </v-btn>
          </div>

          <h2 class="text-h5 font-weight-black mb-1">
            {{ registrationEmail ? 'Check your email' : cardTitle }}
          </h2>
          <p class="text-body-2 muted mb-6">
            {{ registrationEmail ? `We sent a confirmation link to ${registrationEmail}.` : cardCopy }}
          </p>

          <v-alert v-if="backendOffline" type="warning" variant="tonal" class="mb-4" density="compact">
            The API is offline. Run <code>pnpm api:serve</code> and try again.
          </v-alert>
          <v-alert v-else-if="pageError || auth.error" type="error" variant="tonal" class="mb-4" density="compact">
            {{ pageError || auth.error }}
          </v-alert>

          <div v-if="registrationEmail" class="text-center">
            <v-icon icon="mdi-email-check-outline" color="secondary" size="3rem" class="mb-4" />
            <v-alert v-if="success" type="success" variant="tonal" class="mb-5 text-left" density="compact">
              {{ success }}
            </v-alert>
            <v-btn block color="secondary" size="large" :to="{ name: 'auth' }">
              Back to sign in
            </v-btn>
            <v-btn
              class="mt-2"
              variant="text"
              size="small"
              :loading="auth.loading"
              @click="resendConfirmation"
            >
              Resend confirmation email
            </v-btn>
          </div>

          <div v-else-if="pageFlow === 'verify'" class="text-center" aria-live="polite">
            <v-progress-circular v-if="auth.loading" indeterminate color="secondary" size="3rem" class="mb-5" />
            <v-icon v-else :icon="success ? 'mdi-check-circle-outline' : 'mdi-link-off'" :color="success ? 'success' : 'error'" size="3rem" class="mb-5" />
            <v-alert v-if="success" type="success" variant="tonal" class="mb-5 text-left" density="compact">
              {{ success }}
            </v-alert>
            <v-btn v-if="!auth.loading" block color="secondary" size="large" :to="{ name: 'auth' }">
              Continue to sign in
            </v-btn>
          </div>

          <div v-else-if="success" class="text-center" aria-live="polite">
            <v-icon icon="mdi-email-check-outline" color="success" size="3rem" class="mb-4" />
            <v-alert type="success" variant="tonal" class="mb-5 text-left" density="compact">
              {{ success }}
            </v-alert>
            <v-btn block color="secondary" size="large" :to="{ name: 'auth' }">
              Back to sign in
            </v-btn>
          </div>

          <AppForm v-else ref="form" validate-on="submit" autocomplete="off" @submit.prevent="submit">
            <div class="auth-fields">
              <v-text-field
                v-if="pageFlow === 'auth' && mode === 'register'"
                ref="nameField"
                v-model="name"
                autocomplete="off"
                prepend-inner-icon="mdi-account-outline"
                :rules="[required]"
              >
                <template #label>Your name <span class="required-marker">*</span></template>
              </v-text-field>
              <v-text-field
                v-if="pageFlow !== 'reset'"
                ref="emailField"
                v-model="email"
                type="email"
                autocomplete="email"
                prepend-inner-icon="mdi-email-outline"
                :rules="[required, validEmail]"
              >
                <template #label>Email <span class="required-marker">*</span></template>
              </v-text-field>
              <v-text-field
                v-if="pageFlow !== 'forgot'"
                v-model="password"
                :type="visible ? 'text' : 'password'"
                autocomplete="off"
                prepend-inner-icon="mdi-lock-outline"
                :append-inner-icon="visible ? 'mdi-eye-off' : 'mdi-eye'"
                :rules="pageFlow === 'reset' || mode === 'register' ? [required, strongPassword] : [required]"
                @click:append-inner="visible = !visible"
              >
                <template #label>{{ pageFlow === 'reset' ? 'New password' : 'Password' }} <span class="required-marker">*</span></template>
              </v-text-field>
              <v-text-field
                v-if="pageFlow === 'reset' || (pageFlow === 'auth' && mode === 'register')"
                v-model="passwordConfirm"
                :type="confirmVisible ? 'text' : 'password'"
                autocomplete="off"
                prepend-inner-icon="mdi-lock-check-outline"
                :append-inner-icon="confirmVisible ? 'mdi-eye-off' : 'mdi-eye'"
                :rules="[required, matchingPassword]"
                @click:append-inner="confirmVisible = !confirmVisible"
              >
                <template #label>Confirm password <span class="required-marker">*</span></template>
              </v-text-field>
            </div>
            <div v-if="pageFlow === 'auth' && mode === 'login' && !reauthenticating" class="d-flex justify-end mt-1">
              <v-btn variant="text" size="small" :to="{ name: 'forgot-password' }">
                Forgot your password?
              </v-btn>
            </div>
            <v-btn
              type="submit"
              block
              size="large"
              color="secondary"
              class="mt-6"
              :loading="auth.loading"
              append-icon="mdi-arrow-right"
            >
              {{ pageFlow === 'forgot' ? 'Send reset link' : pageFlow === 'reset' ? 'Reset password' : mode === 'login' ? 'Open your day' : 'Create account' }}
            </v-btn>
            <v-btn
              v-if="pageFlow === 'forgot' || pageFlow === 'reset'"
              block
              variant="text"
              class="mt-2"
              :to="{ name: 'auth' }"
            >
              Back to sign in
            </v-btn>
          </AppForm>

          <template v-if="pageFlow === 'auth' && mode === 'login' && passkeyAvailable && !registrationEmail">
            <div class="auth-separator my-5" aria-hidden="true">
              <v-divider />
              <span>or</span>
              <v-divider />
            </div>
            <v-btn
              type="button"
              block
              size="large"
              variant="outlined"
              prepend-icon="mdi-fingerprint"
              :loading="auth.passkeyLoading"
              :disabled="auth.loading"
              @click="signInWithPasskey"
            >
              Sign in with biometrics
            </v-btn>
          </template>
        </v-card>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.auth-page {
  position: relative;
  overflow: hidden;
  background: #191c19;
  color: white;
}

.auth-page::before {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
  background-size: 34px 34px;
  content: '';
}

.auth-glow {
  position: fixed;
  top: -20%;
  right: -35%;
  width: 80vw;
  height: 80vw;
  border-radius: 50%;
  background: rgba(199, 244, 100, 0.16);
  filter: blur(80px);
  pointer-events: none;
}

.auth-wrap {
  position: relative;
  z-index: 1;
  min-height: 100dvh;
  padding-block: 0;
  display: grid;
  align-content: center;
  gap: 2.5rem;
  max-width: 1080px;
}

:global(html.platform-android .auth-wrap),
:global(html.platform-ios .auth-wrap) {
  padding-block:
    max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem))
    max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem));
}

.logo-box {
  display: grid;
  width: 168px;
  height: 56px;
  align-items: center;
  justify-items: start;
}

.logo-box img {
  width: 168px;
  height: 56px;
  object-fit: contain;
  object-position: left center;
}

.auth-title {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  font-size: clamp(3.6rem, 17vw, 7rem);
}

.auth-title__lead {
  font-size: .83em;
  line-height: 1;
}

.auth-title__programmable {
  font-size: .52em;
  line-height: 1;
}

.auth-copy {
  max-width: 450px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 1rem;
  line-height: 1.6;
}

.auth-card {
  color: #191c19;
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 28px 80px rgba(0,0,0,.36) !important;
}

.auth-fields {
  display: grid;
  gap: 1rem;
}

.required-marker {
  color: rgb(var(--v-theme-error));
}

.auth-separator {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: .75rem;
  color: rgb(var(--v-theme-on-surface) / .55);
  font-size: .75rem;
  font-weight: 700;
  text-transform: uppercase;
}

@media (min-width: 800px) {
  .auth-wrap {
    grid-template-columns: 1.15fr .85fr;
    align-items: center;
  }
}

</style>
