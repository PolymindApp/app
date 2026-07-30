<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { isAndroidPasskeyAvailable } from '@/services/passkeys'
import { useAuthStore } from '@/stores/auth'

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const auth = useAuthStore()
const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const name = ref('')
const email = ref('')
const password = ref('')
const visible = ref(false)
const form = ref()
const backendOffline = ref(false)
const emailField = ref<{ focus: () => void }>()
const nameField = ref<{ focus: () => void }>()
const passkeyAvailable = ref(false)

const required = (value: string) => Boolean(value) || 'Required'
const validEmail = (value: string) => /.+@.+\..+/.test(value) || 'Enter a valid email'
const strongPassword = (value: string) => value.length >= 8 || 'Use at least 8 characters'

onMounted(async () => {
  passkeyAvailable.value = await isAndroidPasskeyAvailable()
  if (!allowAutomaticFocus) return
  await nextTick()
  emailField.value?.focus()
})

watch(mode, async (nextMode) => {
  if (!allowAutomaticFocus) return
  await nextTick()
  if (nextMode === 'register') nameField.value?.focus()
  else emailField.value?.focus()
})

async function submit() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  backendOffline.value = false
  try {
    if (mode.value === 'login') await auth.login(email.value, password.value)
    else await auth.register(name.value, email.value, password.value)
    await router.replace('/today')
  } catch (error) {
    backendOffline.value = error instanceof TypeError || (error instanceof Error && /fetch|network/i.test(error.message))
  }
}

async function signInWithPasskey() {
  backendOffline.value = false
  try {
    if (await auth.loginWithPasskey()) await router.replace('/today')
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
            <img src="/brand/mom-wordmark.png" alt="Mom" />
          </div>
          <h1 class="display-title auth-title mt-3">MAKE IT<br />YOURS<span class="text-secondary">.</span></h1>
          <p class="auth-copy mt-5">
            Management of Me keeps tasks, plans, habits, workouts, and timed sessions together—one flexible system for real life.
          </p>
        </section>

        <v-card class="auth-card pa-5 pa-sm-7" color="surface">
          <div class="d-flex ga-2 mb-6">
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
              Join Mom
            </v-btn>
          </div>

          <h2 class="text-h5 font-weight-black mb-1">
            {{ mode === 'login' ? 'Welcome back' : 'Create your space' }}
          </h2>
          <p class="text-body-2 muted mb-6">
            {{ mode === 'login' ? 'Pick up where you left off.' : 'Create a private, synced workspace.' }}
          </p>

          <v-alert v-if="backendOffline" type="warning" variant="tonal" class="mb-4" density="compact">
            The API is offline. Run <code>pnpm api:serve</code> and try again.
          </v-alert>
          <v-alert v-else-if="auth.error" type="error" variant="tonal" class="mb-4" density="compact">
            {{ auth.error }}
          </v-alert>

          <v-form ref="form" validate-on="submit" autocomplete="off" @submit.prevent="submit">
            <div class="auth-fields">
              <v-text-field
                v-if="mode === 'register'"
                ref="nameField"
                v-model="name"
                label="Your name"
                autocomplete="off"
                prepend-inner-icon="mdi-account-outline"
                :rules="[required]"
              />
              <v-text-field
                ref="emailField"
                v-model="email"
                label="Email"
                type="email"
                autocomplete="off"
                prepend-inner-icon="mdi-email-outline"
                :rules="[required, validEmail]"
              />
              <v-text-field
                v-model="password"
                label="Password"
                :type="visible ? 'text' : 'password'"
                autocomplete="off"
                prepend-inner-icon="mdi-lock-outline"
                :append-inner-icon="visible ? 'mdi-eye-off' : 'mdi-eye'"
                :rules="[required, strongPassword]"
                @click:append-inner="visible = !visible"
              />
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
              {{ mode === 'login' ? 'Open your day' : 'Create account' }}
            </v-btn>
          </v-form>

          <template v-if="mode === 'login' && passkeyAvailable">
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
              Sign in with passkey
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
  padding-block: 5rem;
  display: grid;
  align-content: center;
  gap: 2.5rem;
  max-width: 1080px;
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
  font-size: clamp(3.6rem, 17vw, 7rem);
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
