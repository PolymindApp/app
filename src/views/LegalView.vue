<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '@/lib/api'

const route = useRoute()
const isPrivacyPolicy = computed(() => route.name === 'privacy')
const homeRoute = computed(() => api.authStore.hasLocalSession ? '/tasks' : '/')
const appRoute = computed(() => api.authStore.hasLocalSession ? '/settings' : '/auth')
const contactEmail = atob('Y29udGFjdEBkYW5ueWNvdWxvbWJlLmNvbQ==')
const contactEmailHref = `mailto:${contactEmail}`
</script>

<template>
  <v-app theme="forgeDark">
    <v-main class="legal-page app-scroll">
      <header class="legal-header px-4 px-sm-6">
        <router-link :to="homeRoute" class="legal-brand" aria-label="BackOnTrack home">
          <img src="/brand/backontrack-wordmark.png" alt="BackOnTrack" />
        </router-link>
        <v-btn
          :to="appRoute"
          variant="outlined"
          :prepend-icon="api.authStore.hasLocalSession ? 'mdi-arrow-left' : 'mdi-login'"
        >
          {{ api.authStore.hasLocalSession ? 'Back to settings' : 'Open app' }}
        </v-btn>
      </header>

      <article class="legal-document app-page">
        <header class="legal-intro">
          <v-icon
            :icon="isPrivacyPolicy ? 'mdi-shield-lock-outline' : 'mdi-file-document-check-outline'"
            color="secondary"
            size="36"
          />
          <div>
            <h1>{{ isPrivacyPolicy ? 'Privacy policy' : 'Terms and conditions' }}</h1>
            <p>Effective August 20, 2026</p>
          </div>
        </header>

        <v-card class="legal-card surface-card pa-5 pa-sm-8">
          <template v-if="isPrivacyPolicy">
            <p class="legal-lead">
              BackOnTrack is a personal planning, practice, learning, tracking, and reflection app operated by Développement Web DC inc. in Québec, Canada. This policy explains what information BackOnTrack handles, why it is handled, and the choices available to you.
            </p>

            <section>
              <h2>1. Scope</h2>
              <p>This policy applies to the BackOnTrack website, web app, Android app, iOS app, and related services. It does not apply to third-party websites or services that you choose to open or connect.</p>
            </section>

            <section>
              <h2>2. Information we collect</h2>
              <h3>Account and authentication information</h3>
              <p>We collect your name, email address, password hash, account settings, timezone, and email verification or password-reset records. If you enable biometric sign-in, BackOnTrack stores a passkey public credential and receives proof that your device verified you. BackOnTrack does not receive or store your fingerprint, face scan, or device PIN.</p>

              <h3>Content you create</h3>
              <p>We store the information you add to the service, including tasks, schedules, completion and quantity logs, interval plans and sessions, flashcards and optional recordings, tracking data, journal entries and images, profile images, and preferences. If you share a Review set, we also process the invited email address, access role, shared cards, and related review activity.</p>

              <h3>Health Connect and device wellbeing data</h3>
              <p>On Android, and only after you grant permission, BackOnTrack reads aggregate daily step totals from Health Connect. It uses those totals to update step-counter tasks and build insights. A step total saved as task progress is synchronized with your account like other task data. BackOnTrack does not write to Health Connect.</p>
              <p>After you separately grant Android Usage Access, BackOnTrack reads screen-interactive events and calculates daily screen-time minutes on your device for tracking insights. Raw app-usage details and screen events are not uploaded to BackOnTrack's server. These permissions are optional and can be revoked in Android or Health Connect settings.</p>

              <h3>Technical and diagnostic information</h3>
              <p>We process information needed to operate and secure the service, such as IP address for authentication rate limits, device or sync-client identifiers, browser or device type, app version, push-notification subscription details, and request timestamps. Authenticated clients may send bounded JavaScript and network error reports containing an error message, source path without query strings, request method and status, stack trace, platform, app version, and user agent. Request bodies are not included.</p>

              <h3>Local storage</h3>
              <p>BackOnTrack uses IndexedDB, local storage, service-worker caches, and similar device storage to keep the app available offline, retain your session, queue changes, recover active timers, remember preferences, and hold diagnostics until they can be sent. This storage is functional; we do not use third-party advertising or cross-site tracking cookies.</p>
            </section>

            <section>
              <h2>3. How we use information</h2>
              <ul>
                <li>Provide, synchronize, and restore the features you choose to use.</li>
                <li>Authenticate accounts, send account emails, and support passkeys.</li>
                <li>Schedule reminders and deliver notifications you enable.</li>
                <li>Enable Review set sharing with people you invite.</li>
                <li>Maintain security, prevent abuse, troubleshoot errors, and improve reliability.</li>
                <li>Comply with legal obligations and enforce our terms.</li>
              </ul>
              <p>We do not sell personal information. We do not use Health Connect data, screen-time data, journal content, or other sensitive information for advertising, credit, insurance, employment, or data-broker purposes.</p>
            </section>

            <section>
              <h2>4. When information is shared</h2>
              <p>We disclose information only as needed to operate the service, when you direct us to share it, or when required by law:</p>
              <ul>
                <li><strong>People you invite.</strong> Review set recipients receive the set and cards covered by the role you grant. Editors can change matching source cards, as described before you grant access.</li>
                <li><strong>Infrastructure providers.</strong> Hosting, email-delivery, and push-notification providers process the limited information needed to perform those services for us.</li>
                <li><strong>Legal and safety reasons.</strong> We may preserve or disclose information when reasonably necessary to comply with law, protect rights or safety, investigate abuse, or defend legal claims.</li>
                <li><strong>Business transfer.</strong> Information may transfer as part of a merger, financing, reorganization, or sale, subject to this policy and applicable law.</li>
              </ul>
              <p>We do not share Health Connect data with advertisers, data brokers, or information resellers.</p>
            </section>

            <section>
              <h2>5. Legal grounds</h2>
              <p>Where applicable law requires a legal basis, we process information to perform our agreement with you, with your consent for optional device permissions and notifications, for legitimate interests such as securing and improving the service, and to meet legal obligations. You may withdraw optional consent through device settings, but this does not affect earlier lawful processing.</p>
            </section>

            <section>
              <h2>6. Retention and deletion</h2>
              <p>Account content is generally kept while your account is active. When you delete content, it is removed from active use, though short-lived sync records, security records, or backups may remain until their normal expiry or deletion cycle. Push subscriptions that are no longer valid are removed automatically. We keep other records only as long as reasonably needed for the purposes above or as required by law.</p>
              <p>You can delete individual tasks, logs, intervals, flashcards, trackers, and journal entries in the app. To request deletion of your account and associated server data, contact us using the details below. Removing the app or signing out clears that account's local app database from the device, but does not by itself delete the server account.</p>
            </section>

            <section>
              <h2>7. Security</h2>
              <p>We use safeguards appropriate to the information involved, including HTTPS in transit, hashed passwords, signed sessions, account-based access controls, restricted server data access, and local device isolation. No system can guarantee absolute security, so protect your device and credentials and contact us if you suspect unauthorized access.</p>
            </section>

            <section>
              <h2>8. Your choices and rights</h2>
              <p>Depending on where you live, you may have rights to access, correct, export, delete, or restrict certain uses of your personal information, withdraw consent, or complain to a privacy regulator. You can change much of your content and settings directly in the app. You may also revoke Health Connect, Usage Access, microphone, camera, or notification permissions in device settings.</p>
              <p>To make a privacy request, contact us. We may need to verify your identity before acting on a request.</p>
            </section>

            <section>
              <h2>9. International processing</h2>
              <p>Information may be processed in Canada and in other countries where service providers operate. Those countries may have different privacy laws. Where required, we use appropriate contractual or legal protections for cross-border processing.</p>
            </section>

            <section>
              <h2>10. Children</h2>
              <p>BackOnTrack is not directed to children who cannot legally consent to the processing of their information. If you believe a child provided personal information without required consent, contact us so we can review and delete it where appropriate.</p>
            </section>

            <section>
              <h2>11. Changes to this policy</h2>
              <p>We may update this policy as the service or legal requirements change. We will post the revised policy here, change the effective date, and provide additional notice when a change is material and the law requires it.</p>
            </section>
          </template>

          <template v-else>
            <p class="legal-lead">
              These terms are an agreement between you and Développement Web DC inc., the Québec, Canada operator of BackOnTrack. By accessing BackOnTrack, creating an account, or using the service, you agree to these terms and the <router-link to="/privacy">privacy policy</router-link>.
            </p>

            <section>
              <h2>1. Who may use BackOnTrack</h2>
              <p>You must be legally capable of agreeing to these terms. If you have not reached the age of majority where you live, a parent or legal guardian must review and agree to these terms on your behalf. You may not use the service where doing so would violate applicable law.</p>
            </section>

            <section>
              <h2>2. Your account</h2>
              <p>Provide accurate registration information, keep your credentials secure, and promptly tell us about suspected unauthorized use. You are responsible for activity performed through your account unless applicable law says otherwise. One person may not use the service to impersonate another person or misrepresent an affiliation.</p>
            </section>

            <section>
              <h2>3. The service</h2>
              <p>BackOnTrack provides tools for planning tasks, running intervals, reviewing flashcards, tracking personal information, exploring patterns, and journaling. Features may work offline and synchronize later. We may add, change, suspend, or discontinue features, and we may set reasonable technical limits to keep the service reliable and secure.</p>
              <p>Offline changes, delayed synchronization, notification delivery, background timers, device permissions, and third-party platform behavior can be affected by your device, operating system, connectivity, or provider. Keep independent copies of information you cannot afford to lose and do not rely on BackOnTrack as your only record.</p>
            </section>

            <section>
              <h2>4. Health and safety</h2>
              <p>BackOnTrack is a general productivity and personal wellbeing tool. It is not a medical device and does not provide medical, mental-health, fitness, legal, or other professional advice. Insights show associations in the information selected; they do not establish causation, diagnosis, or treatment.</p>
              <p>Use your own judgment, follow professional advice, and stop an activity if it may be unsafe. Do not use timers, reminders, Health Connect data, screen-time data, or notifications for emergencies or in situations where delay, error, or interruption could cause harm. Contact appropriate emergency services or a qualified professional when needed.</p>
            </section>

            <section>
              <h2>5. Your content</h2>
              <p>You keep ownership of content you submit. You give us a limited, worldwide, non-exclusive licence to host, copy, transmit, process, and display that content only as needed to provide, secure, and improve BackOnTrack and to follow your sharing choices. This licence ends when the content is deleted from our systems, subject to normal technical retention and legal obligations.</p>
              <p>You represent that you have the rights and permissions needed for content you upload or share. Do not upload unlawful content or another person's confidential, private, copyrighted, or biometric information without authorization.</p>
            </section>

            <section>
              <h2>6. Sharing and collaboration</h2>
              <p>When you invite someone to a Review set, they can access information covered by the role you choose. Editors may add, modify, and permanently delete matching cards in the owner's source library. Review access before granting it, invite only intended recipients, and remove access when it is no longer appropriate. Recipients must use shared content only as authorized by the owner and these terms.</p>
            </section>

            <section>
              <h2>7. Acceptable use</h2>
              <p>You must not:</p>
              <ul>
                <li>Break the law, violate another person's rights, or use the service for fraud, harassment, abuse, or harm.</li>
                <li>Probe, bypass, disable, or interfere with security, authentication, access controls, rate limits, or service operation.</li>
                <li>Access another account or non-public data without permission.</li>
                <li>Upload malware or use automated traffic that unreasonably burdens the service.</li>
                <li>Reverse engineer protected parts of the service except where applicable law or an open-source licence expressly permits it.</li>
                <li>Resell or commercially exploit the hosted service without written permission.</li>
              </ul>
            </section>

            <section>
              <h2>8. BackOnTrack materials</h2>
              <p>Except for your content and third-party materials, BackOnTrack's branding, interface, and service materials belong to us or our licensors. We grant you a personal, limited, revocable, non-exclusive, non-transferable licence to use the app as intended under these terms. Open-source components and source code remain governed by their applicable licence notices.</p>
            </section>

            <section>
              <h2>9. Third-party services</h2>
              <p>BackOnTrack may interact with operating-system features and third-party services such as Health Connect, email delivery, browser push services, or links you provide. Their own terms and privacy practices apply. We do not control and are not responsible for third-party services.</p>
            </section>

            <section>
              <h2>10. Suspension and termination</h2>
              <p>You may stop using BackOnTrack at any time and may request account deletion. We may restrict or terminate access when reasonably necessary to address a material breach, security risk, unlawful conduct, harm to others, or discontinuation of the service. Where practical and lawful, we will provide notice and an opportunity to address the issue.</p>
              <p>Terms that by their nature should continue after termination—including ownership, disclaimers, liability limits, and dispute terms—will continue.</p>
            </section>

            <section>
              <h2>11. Disclaimers</h2>
              <p>To the maximum extent permitted by law, BackOnTrack is provided “as is” and “as available.” We do not promise that it will always be available, secure, uninterrupted, error-free, or that reminders, calculations, synchronization, insights, or device integrations will always be accurate. Nothing in these terms excludes warranties or rights that cannot lawfully be excluded.</p>
            </section>

            <section>
              <h2>12. Limitation of liability</h2>
              <p>To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive loss, or for loss of data, profits, opportunities, or goodwill arising from the service. Our total liability for claims relating to BackOnTrack will not exceed the greater of the amount you paid us for the service during the 12 months before the claim or CAD $100.</p>
              <p>These limits do not apply where prohibited by law or to liability that cannot lawfully be limited, including liability for fraud, wilful misconduct, or gross negligence where applicable.</p>
            </section>

            <section>
              <h2>13. Indemnity</h2>
              <p>To the extent permitted by law, you will indemnify us against third-party claims and reasonable costs arising from your unlawful use of the service, your content, or your material breach of these terms. This does not require you to indemnify us for our own unlawful conduct or negligence.</p>
            </section>

            <section>
              <h2>14. Governing law and disputes</h2>
              <p>These terms are governed by the laws of Québec and the federal laws of Canada applicable there, without regard to conflict-of-law rules. Subject to consumer rights that require another forum, the courts located in Québec have exclusive jurisdiction. Before filing a claim, you and BackOnTrack agree to try in good faith to resolve it informally by written notice.</p>
            </section>

            <section>
              <h2>15. Changes to these terms</h2>
              <p>We may update these terms to reflect changes to BackOnTrack, risk, or law. We will post the revised terms, update the effective date, and provide additional notice when required. If you continue using the service after revised terms take effect, you accept them. If you do not agree, stop using the service and request account deletion.</p>
            </section>

            <section>
              <h2>16. General</h2>
              <p>If part of these terms is unenforceable, the remaining terms continue. A failure to enforce a term is not a waiver. You may not transfer these terms without our consent; we may transfer them as part of a reorganization or transfer of the service. These terms and the privacy policy are the entire agreement about your use of BackOnTrack unless we expressly agree otherwise in writing.</p>
            </section>
          </template>

          <section class="legal-contact">
            <h2>{{ isPrivacyPolicy ? '12. Contact us' : '17. Contact us' }}</h2>
            <p>Questions, privacy requests, account-deletion requests, and legal notices can be sent to:</p>
            <address>
              Développement Web DC inc.<br />
              Québec, Canada<br />
              <a :href="contactEmailHref">{{ contactEmail }}</a>
            </address>
          </section>
        </v-card>

        <nav class="legal-switcher" aria-label="Legal pages">
          <router-link to="/privacy">Privacy policy</router-link>
          <span aria-hidden="true">·</span>
          <router-link to="/terms">Terms and conditions</router-link>
        </nav>
      </article>
    </v-main>
  </v-app>
</template>

<style scoped>
.legal-page {
  min-height: var(--app-viewport-height, 100dvh);
  background:
    radial-gradient(circle at 82% 4%, rgba(var(--v-theme-secondary), .1), transparent 24rem),
    rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
}

.legal-header {
  display: flex;
  width: 100%;
  max-width: 84rem;
  min-height: 5.5rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-inline: auto;
  border-bottom: .0625rem solid rgba(var(--v-theme-on-surface), .08);
}

.legal-brand {
  display: inline-flex;
  align-items: center;
}

.legal-brand img {
  display: block;
  width: 10.5rem;
  height: auto;
}

.legal-document {
  max-width: 56.25rem;
  padding-top: 2rem;
  padding-bottom: calc(2rem + var(--page-safe-area-bottom));
}

.legal-intro {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: .5rem .25rem 1.5rem;
}

.legal-intro h1 {
  font-size: clamp(1.9rem, 5vw, 2.8rem);
  font-weight: 900;
  letter-spacing: -.045em;
  line-height: 1;
}

.legal-intro p {
  margin-top: .4rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .8rem;
  font-weight: 700;
}

.legal-card {
  background: rgba(var(--v-theme-surface), .94);
}

.legal-lead {
  padding-bottom: 1.5rem;
  border-bottom: .0625rem solid rgba(var(--v-theme-on-surface), .1);
  color: rgb(var(--v-theme-on-surface) / .78);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.7;
}

section {
  margin-top: 2rem;
}

h2 {
  margin-bottom: .75rem;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: -.015em;
}

h3 {
  margin: 1.25rem 0 .4rem;
  color: rgb(var(--v-theme-on-surface) / .9);
  font-size: .88rem;
  font-weight: 900;
}

section p,
section li,
address {
  color: rgb(var(--v-theme-on-surface) / .66);
  font-size: .88rem;
  line-height: 1.72;
}

section p + p {
  margin-top: .75rem;
}

ul {
  display: grid;
  gap: .5rem;
  margin: .75rem 0;
  padding-left: 1.25rem;
}

a {
  color: rgb(var(--v-theme-secondary));
  font-weight: 800;
  text-underline-offset: .18rem;
}

.legal-contact {
  padding-top: 1.75rem;
  border-top: .0625rem solid rgba(var(--v-theme-on-surface), .1);
}

address {
  margin-top: .75rem;
  font-style: normal;
}

.legal-switcher {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: .65rem;
  padding: 1.5rem 0 .5rem;
  color: rgb(var(--v-theme-on-surface) / .4);
  font-size: .78rem;
}

.legal-switcher a {
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  color: rgb(var(--v-theme-on-surface) / .64);
  text-decoration: none;
}

.legal-switcher a:hover,
.legal-switcher a:focus-visible,
.legal-switcher a.router-link-active {
  color: rgb(var(--v-theme-secondary));
}

@media (max-width: 37.5rem) {
  .legal-header {
    min-height: 4.75rem;
  }

  .legal-brand img {
    width: 8rem;
  }

  .legal-header :deep(.v-btn) {
    padding-inline: .75rem;
  }

  .legal-document {
    padding-top: 1.25rem;
  }

  .legal-intro {
    align-items: flex-start;
  }
}
</style>
