<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, onMounted, ref } from 'vue'
import AccountAvatarEditor from '@/components/AccountAvatarEditor.vue'
import AppForm from '@/components/AppForm.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { isAndroidPasskeyAvailable } from '@/services/passkeys'
import { useAuthStore } from '@/stores/auth'

type BiometricState = 'checking' | 'available' | 'connected' | 'unavailable' | 'error'

const auth = useAuthStore()
const form = ref()
const name = ref(auth.user?.name || '')
const biometricState = ref<BiometricState>('checking')
const disconnectBiometricsDialog = ref(false)
const notice = ref(false)
const noticeColor = ref<'success' | 'error'>('success')
const noticeText = ref('')
const isAndroidApp = Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()

const accountInitials = computed(() => {
  const source = auth.user?.name || auth.user?.email || 'A'
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'A'
})
const nameChanged = computed(() => (
  name.value.trim() !== (auth.user?.name || '').trim()
))

const required = (value: string) => Boolean(value.trim()) || 'Enter your name'
const validLength = (value: string) => value.trim().length <= 160 || 'Use 160 characters or fewer'

onMounted(checkBiometricStatus)

async function saveProfile() {
  const result = await form.value?.validate()
  if (!result?.valid || !nameChanged.value) return

  try {
    await auth.updateName(name.value.trim())
    name.value = auth.user?.name || name.value.trim()
    showNotice('success', 'Your name has been updated.')
  } catch {
    showNotice('error', auth.error || 'Your name could not be updated.')
  }
}

async function uploadAvatar(image: Blob) {
  try {
    await auth.updateAvatar(image)
    showNotice('success', 'Your avatar has been updated.')
  } catch {
    showNotice('error', auth.error || 'Your avatar could not be updated.')
  }
}

async function removeAvatar() {
  try {
    await auth.removeAvatar()
    showNotice('success', 'Your avatar has been removed.')
  } catch {
    showNotice('error', auth.error || 'Your avatar could not be removed.')
  }
}

async function checkBiometricStatus() {
  biometricState.value = 'checking'
  if (!isAndroidApp || !await isAndroidPasskeyAvailable()) {
    biometricState.value = 'unavailable'
    return
  }

  try {
    biometricState.value = await auth.hasRegisteredPasskey()
      ? 'connected'
      : 'available'
  } catch {
    biometricState.value = 'error'
  }
}

async function connectBiometrics() {
  try {
    if (!await auth.registerPasskey()) return
    biometricState.value = 'connected'
    showNotice('success', 'Biometric sign-in is ready.')
  } catch {
    showNotice('error', auth.error || 'Biometric sign-in could not be connected.')
  }
}

async function disconnectBiometrics() {
  try {
    await auth.disconnectPasskeys()
    disconnectBiometricsDialog.value = false
    biometricState.value = 'available'
    showNotice('success', 'Biometric sign-in has been disconnected.')
  } catch {
    showNotice('error', auth.error || 'Biometric sign-in could not be disconnected.')
  }
}

function showNotice(color: 'success' | 'error', text: string) {
  noticeColor.value = color
  noticeText.value = text
  notice.value = true
}
</script>

<template>
  <main class="app-page account-page">
    <header class="account-intro">
      <AccountAvatarEditor
        :avatar-url="auth.user?.avatar"
        :initials="accountInitials"
        :loading="auth.avatarLoading"
        @upload="uploadAvatar"
        @remove="removeAvatar"
        @error="message => showNotice('error', message)"
      />
      <div>
        <h1 class="text-h5 font-weight-black">Your account</h1>
        <p>Manage your profile and how you securely sign in.</p>
      </div>
    </header>

    <v-card class="surface-card pa-5 pa-sm-6">
      <div class="account-section-heading">
        <div>
          <h2>Profile</h2>
          <p>This is the name shown throughout Polymind.</p>
        </div>
        <v-icon icon="mdi-account-outline" />
      </div>

      <AppForm ref="form" validate-on="submit" @submit.prevent="saveProfile">
        <div class="account-fields">
          <v-text-field
            v-model="name"
            label="Name"
            maxlength="160"
            counter
            prepend-inner-icon="mdi-account-outline"
            :rules="[required, validLength]"
          />
          <v-text-field
            :model-value="auth.user?.email || ''"
            label="Email"
            type="email"
            readonly
            prepend-inner-icon="mdi-email-outline"
            hint="Your email cannot be changed here."
            persistent-hint
          />
        </div>

        <div class="account-actions">
          <v-btn
            type="submit"
            color="secondary"
            :disabled="!nameChanged"
            :loading="auth.accountLoading"
          >
            Save changes
          </v-btn>
        </div>
      </AppForm>
    </v-card>

    <v-card class="surface-card pa-5 pa-sm-6">
      <div class="account-section-heading">
        <div>
          <h2>Biometric sign-in</h2>
          <p>Use your fingerprint, face, or device screen lock instead of typing your password.</p>
        </div>
        <v-icon icon="mdi-fingerprint" />
      </div>

      <v-progress-linear
        v-if="biometricState === 'checking'"
        color="secondary"
        indeterminate
        rounded
        class="mt-5"
      />

      <div v-else-if="biometricState === 'connected'" class="biometric-connected">
        <v-alert
          type="success"
          variant="tonal"
          icon="mdi-shield-check-outline"
        >
          <strong>Biometrics connected</strong>
          <p class="mt-1">You can use your fingerprint, face, or screen lock from the sign-in page.</p>
        </v-alert>
        <v-btn
          color="error"
          variant="outlined"
          prepend-icon="mdi-fingerprint-off"
          :loading="auth.passkeyLoading"
          @click="disconnectBiometricsDialog = true"
        >
          Disconnect biometrics
        </v-btn>
      </div>

      <div v-else-if="biometricState === 'available'" class="biometric-action">
        <div class="biometric-privacy">
          <v-icon icon="mdi-shield-lock-outline" size="20" />
          <p>Your biometric data stays on your device. Polymind only receives confirmation that it was you.</p>
        </div>
        <v-btn
          color="secondary"
          prepend-icon="mdi-fingerprint"
          :loading="auth.passkeyLoading"
          @click="connectBiometrics"
        >
          Connect biometrics
        </v-btn>
      </div>

      <v-alert
        v-else-if="biometricState === 'error'"
        type="warning"
        variant="tonal"
        class="mt-5"
      >
        <div class="biometric-error">
          <span>Polymind could not check your biometric sign-in status.</span>
          <v-btn size="small" variant="tonal" @click="checkBiometricStatus">Try again</v-btn>
        </div>
      </v-alert>

      <v-alert
        v-else
        type="info"
        variant="tonal"
        icon="mdi-cellphone"
        class="mt-5"
      >
        {{
          isAndroidApp
            ? 'Biometric sign-in is not available on this device.'
            : 'Open Polymind on Android to connect biometric sign-in.'
        }}
      </v-alert>
    </v-card>

    <ConfirmDialog
      v-model="disconnectBiometricsDialog"
      title="Disconnect biometrics?"
      message="You will no longer be able to use your fingerprint, face, or screen lock to sign in. You can connect biometrics again later."
      confirm-text="Disconnect"
      icon="mdi-fingerprint-off"
      :loading="auth.passkeyLoading"
      @confirm="disconnectBiometrics"
    />

    <v-snackbar
      v-model="notice"
      :color="noticeColor"
      location="bottom"
      :timeout="4500"
    >
      {{ noticeText }}
    </v-snackbar>
  </main>
</template>

<style scoped>
.account-page {
  display: grid;
  gap: 1rem;
}

.account-intro {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: .5rem .25rem .75rem;
}

.account-intro p,
.account-section-heading p,
.biometric-privacy p {
  margin-top: .2rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .78rem;
  line-height: 1.45;
}

.account-section-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 1rem;
}

.account-section-heading h2 {
  font-size: 1rem;
  font-weight: 900;
}

.account-section-heading > .v-icon {
  color: rgb(var(--v-theme-secondary));
}

.account-fields {
  display: grid;
  gap: .25rem;
  margin-top: 1.5rem;
}

.account-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

.biometric-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  margin-top: 1.5rem;
}

.biometric-connected {
  display: grid;
  justify-items: end;
  gap: .75rem;
  margin-top: 1.25rem;
}

.biometric-privacy {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: .65rem;
}

.biometric-privacy .v-icon {
  flex: 0 0 auto;
  margin-top: .15rem;
  color: rgb(var(--v-theme-secondary));
}

.biometric-privacy p {
  margin: 0;
}

.biometric-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

@media (max-width: 520px) {
  .biometric-action {
    align-items: stretch;
    flex-direction: column;
  }

  .biometric-action .v-btn {
    width: 100%;
  }

  .biometric-connected .v-btn {
    width: 100%;
  }

  .biometric-error {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
