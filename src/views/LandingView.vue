<script setup lang="ts">
const appSections = [
  {
    title: 'Tasks',
    role: 'Plan',
    description: 'Schedule actions, targets, intervals, Review sets, check-ins, or complete multi-step programs.',
    connection: 'Launch the right practice at the right time',
    icon: 'mdi-clipboard-check-outline',
  },
  {
    title: 'Intervals',
    role: 'Practise',
    description: 'Build timed sequences for focus, workouts, recovery, and any routine that benefits from structure.',
    connection: 'Include a Flashcard Review set in a routine',
    icon: 'mdi-timer-outline',
  },
  {
    title: 'Flashcards',
    role: 'Learn',
    description: 'Create focused Review sets with your own cards, order, pace, audio, and active or passive review.',
    connection: 'Review alone, from a task, or inside an interval',
    icon: 'mdi-cards-outline',
  },
  {
    title: 'Tracking',
    role: 'Measure',
    description: 'Log the factors and outcomes that matter, then compare them with your completed activity.',
    connection: 'Relate outcomes to tasks, intervals, and reviews',
    icon: 'mdi-chart-timeline-variant',
  },
  {
    title: 'Journal',
    role: 'Reflect',
    description: 'Write privately with the task and tracker snapshots that give each day its real context.',
    connection: 'Use what you learn to tune the next plan',
    icon: 'mdi-notebook-outline',
  },
]

const systemFlow = [
  { label: 'Plan', icon: 'mdi-clipboard-check-outline' },
  { label: 'Practise', icon: 'mdi-timer-outline' },
  { label: 'Learn', icon: 'mdi-cards-outline' },
  { label: 'Measure', icon: 'mdi-chart-timeline-variant' },
  { label: 'Reflect', icon: 'mdi-notebook-outline' },
]

const screenshots = [
  {
    title: 'Tasks',
    src: '/images/tasks.jpeg',
    alt: 'BackOnTrack Tasks screen showing a weekly plan, completion progress, and programmable targets.',
  },
  {
    title: 'Intervals',
    src: '/images/intervals.jpeg',
    alt: 'BackOnTrack Intervals screen running a programmed exercise sequence with timing and repetition progress.',
  },
  {
    title: 'Tracking',
    src: '/images/tracking.jpeg',
    alt: 'BackOnTrack Tracking screen showing configurable wellbeing trackers and weekly patterns.',
  },
]

const learningFlow = [
  {
    title: 'Tasks',
    description: 'Schedule the practice and make it part of a larger program.',
    icon: 'mdi-clipboard-check-outline',
  },
  {
    title: 'Intervals',
    description: 'Place a Review set inside a timed routine, with work, rest, and repetition around it.',
    icon: 'mdi-timer-outline',
  },
  {
    title: 'Flashcards',
    description: 'Learn actively or passively with custom cards, audio, tags, pacing, and review order.',
    icon: 'mdi-cards-outline',
  },
  {
    title: 'Trackers',
    description: 'Compare practice and interval history with the factors and outcomes you care about.',
    icon: 'mdi-chart-timeline-variant',
  },
  {
    title: 'Journal',
    description: 'Connect a reflection to its task and tracker snapshots so the numbers keep their context.',
    icon: 'mdi-notebook-outline',
  },
]

function scrollToFeatures() {
  const featuresSection = document.getElementById('features')
  if (!featuresSection) return

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  featuresSection.scrollIntoView({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'start',
  })
}
</script>

<template>
  <v-app theme="forgeDark">
    <v-main class="landing-page app-scroll">
      <header class="landing-header px-6 px-lg-10">
        <router-link to="/" class="landing-brand" aria-label="BackOnTrack home">
          <img src="/brand/backontrack-wordmark.png" alt="BackOnTrack" />
        </router-link>
        <div class="landing-header__actions">
          <v-btn
            variant="outlined"
            size="large"
            href="https://github.com/BackOnTrackApp/app/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            prepend-icon="mdi-cellphone-arrow-down"
          >
            Get the app
          </v-btn>
          <v-btn class="landing-header__web-action" color="secondary" size="large" to="/auth" append-icon="mdi-arrow-right">
            Open web app
          </v-btn>
        </div>
      </header>

      <main>
        <section class="hero-section px-6 px-lg-10">
          <div class="hero-glow" aria-hidden="true" />
          <v-row class="hero-grid" align="center">
            <v-col cols="12" lg="5" order="2" order-lg="1" class="hero-copy">
              <h1>Build your way <span class="text-secondary">forward.</span></h1>
              <p class="mt-6">
                BackOnTrack turns what matters to you into a system you can fine-tune, from daily actions and multi-step routines to precise timers, learning, tracking, and reflection.
              </p>
              <div class="hero-actions mt-8">
                <v-btn color="secondary" size="x-large" to="/auth" append-icon="mdi-arrow-right">
                  Get started
                </v-btn>
                <a class="feature-link" href="#features" @click.prevent="scrollToFeatures">
                  See what it does
                  <v-icon icon="mdi-arrow-down" size="18" />
                </a>
              </div>
              <div class="hero-points mt-8">
                <span><v-icon icon="mdi-check-circle" color="secondary" size="18" /> Fully programmable</span>
                <span><v-icon icon="mdi-check-circle" color="secondary" size="18" /> Fine-tuned to you</span>
                <span><v-icon icon="mdi-check-circle" color="secondary" size="18" /> Made to evolve</span>
              </div>
            </v-col>

            <v-col cols="12" lg="7" order="1" order-lg="2">
              <div class="phone-gallery" aria-label="BackOnTrack mobile app screenshots">
                <div
                  v-for="(screenshot, index) in screenshots"
                  :key="screenshot.title"
                  class="phone-frame"
                  :class="{ 'phone-frame--featured': index === 1 }"
                >
                  <img
                    class="phone-frame__image"
                    :src="screenshot.src"
                    :alt="screenshot.alt"
                    decoding="async"
                  />
                </div>
              </div>
            </v-col>
          </v-row>
        </section>

        <section id="features" class="feature-section px-6 px-lg-10">
          <div class="section-intro">
            <h2>Five sections. One feedback loop<span class="text-secondary">.</span></h2>
            <p>Each section does one job well. Together, they turn a plan into practice, evidence, and a better next step.</p>
          </div>

          <v-row class="app-section-grid mt-10" align="stretch">
            <v-col
              v-for="(section, index) in appSections"
              :key="section.title"
              class="app-section-col"
              cols="12"
              sm="6"
              lg
            >
              <v-card class="app-section-card surface-card pa-5" height="100%">
                <div class="app-section-card__top">
                  <div class="feature-icon">
                    <v-icon :icon="section.icon" size="25" />
                  </div>
                  <span class="app-section-card__number">0{{ index + 1 }}</span>
                </div>
                <p class="app-section-card__role mt-5">{{ section.role }}</p>
                <h3 class="mt-1">{{ section.title }}</h3>
                <p class="app-section-card__description mt-3">{{ section.description }}</p>
                <div class="app-section-card__connection mt-5">
                  <v-icon icon="mdi-link-variant" size="16" />
                  <span>{{ section.connection }}</span>
                </div>
              </v-card>
            </v-col>
          </v-row>

          <v-card class="system-flow surface-card mt-6 pa-5 pa-md-6" aria-label="How the main sections work together">
            <div class="system-flow__intro">
              <div class="system-flow__loop">
                <v-icon icon="mdi-sync" size="23" />
              </div>
              <div>
                <strong>Everything stays connected</strong>
                <p>Schedule the work, do it your way, see what changed, and carry that context into tomorrow.</p>
              </div>
            </div>

            <div class="system-flow__steps">
              <template v-for="(step, index) in systemFlow" :key="step.label">
                <div class="system-flow__step">
                  <v-icon :icon="step.icon" size="18" />
                  <span>{{ step.label }}</span>
                </div>
                <v-icon
                  v-if="index < systemFlow.length - 1"
                  class="system-flow__arrow"
                  icon="mdi-arrow-right"
                  size="17"
                />
              </template>
              <v-icon class="system-flow__return" icon="mdi-arrow-u-left-top" size="19" />
            </div>
          </v-card>
        </section>

        <section class="learning-section px-6 px-lg-10">
          <v-card class="learning-card surface-card pa-5 pa-md-8 pa-lg-12">
            <v-row align="center" class="learning-grid">
              <v-col cols="12" md="5" lg="4" class="learning-visual">
                <div class="learning-phone">
                  <img
                    src="/images/flashcards.jpeg"
                    alt="Passive flashcard review in BackOnTrack, showing Chinese pronunciation, translation, audio replay, progress, and difficulty tags."
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </v-col>

              <v-col cols="12" md="7" lg="8" class="learning-copy">
                <div class="learning-heading">
                  <h2>Learning, woven into everything else<span class="text-secondary">.</span></h2>
                  <p class="mt-4">
                    Flashcards are not a separate island. Build a Review set into an interval, schedule that interval as a task, then use trackers and journal posts to understand how the practice fits into your life.
                  </p>
                </div>

                <div class="learning-flow mt-8" aria-label="How BackOnTrack learning connects across the app">
                  <div v-for="(item, index) in learningFlow" :key="item.title" class="learning-step">
                    <div class="learning-step__marker">
                      <v-icon :icon="item.icon" size="22" />
                    </div>
                    <div class="learning-step__copy">
                      <div class="learning-step__label">
                        <span>{{ item.title }}</span>
                        <v-icon
                          v-if="index < learningFlow.length - 1"
                          class="learning-step__arrow"
                          icon="mdi-arrow-right"
                          size="16"
                          aria-hidden="true"
                        />
                      </div>
                      <p>{{ item.description }}</p>
                    </div>
                  </div>
                </div>

                <div class="learning-loop mt-7">
                  <v-icon icon="mdi-sync" color="secondary" size="22" />
                  <p><strong>One connected feedback loop.</strong> Plan, practise, measure, reflect, and use what you learn to tune the next session.</p>
                </div>
              </v-col>
            </v-row>
          </v-card>
        </section>

        <section class="closing-section px-6 px-lg-10">
          <v-card class="closing-card pa-8 pa-lg-12" color="surface">
            <div>
              <h2>Build a system that grows with you.</h2>
              <p class="mt-3">Start with what matters. Program the details. Keep tuning as your life changes.</p>
            </div>
            <v-btn color="secondary" size="x-large" to="/auth" append-icon="mdi-arrow-right">
              Start building
            </v-btn>
          </v-card>
        </section>
      </main>

      <footer class="landing-footer px-6 px-lg-10">
        <img src="/brand/backontrack-wordmark.png" alt="BackOnTrack" />
        <span>Build your way forward.</span>
      </footer>
    </v-main>
  </v-app>
</template>

<style scoped>
.landing-page {
  position: relative;
  background:
    linear-gradient(rgba(var(--v-theme-on-surface), .02) .0625rem, transparent .0625rem),
    linear-gradient(90deg, rgba(var(--v-theme-on-surface), .02) .0625rem, transparent .0625rem),
    rgb(var(--v-theme-background));
  background-size: 2.125rem 2.125rem;
  color: rgb(var(--v-theme-on-background));
}

.landing-header,
.hero-section,
.feature-section,
.learning-section,
.closing-section,
.landing-footer {
  width: 100%;
  max-width: 84rem;
  margin-inline: auto;
}

.landing-header {
  position: relative;
  z-index: 3;
  display: flex;
  min-height: 6.5rem;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
}

.landing-brand {
  display: inline-flex;
  align-items: center;
}

.landing-brand img,
.landing-footer img {
  width: 8.75rem;
  height: auto;
  display: block;
}

.landing-brand img {
  width: 13.125rem;
}

.landing-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: .75rem;
}

.hero-section {
  position: relative;
  min-height: calc(100dvh - 6.5rem);
  display: grid;
  align-items: center;
  padding-block: 4rem 7rem;
}

.hero-glow {
  position: absolute;
  top: 5%;
  right: 4%;
  width: 38rem;
  height: 38rem;
  border-radius: 50%;
  background: rgba(var(--v-theme-secondary), .11);
  filter: blur(6rem);
  pointer-events: none;
}

.hero-grid {
  position: relative;
  z-index: 1;
}

.hero-copy h1,
.section-intro h2,
.closing-card h2 {
  max-width: 12ch;
  font-weight: 900;
  letter-spacing: -.055em;
  line-height: .98;
}

.hero-copy h1 {
  font-size: clamp(3.25rem, 4.7vw, 5.25rem);
}

.hero-copy > p {
  max-width: 34rem;
  color: rgb(var(--v-theme-on-surface) / .68);
  font-size: 1.18rem;
  line-height: 1.65;
}

.hero-actions,
.hero-points {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.5rem;
}

.feature-link {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  gap: .5rem;
  color: rgb(var(--v-theme-on-background));
  font-size: .9rem;
  font-weight: 800;
  text-decoration: none;
}

.feature-link:hover,
.feature-link:focus-visible {
  color: rgb(var(--v-theme-secondary));
}

.hero-points span {
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  color: rgb(var(--v-theme-on-surface) / .7);
  font-size: .8rem;
  font-weight: 800;
}

.phone-gallery {
  position: relative;
  display: flex;
  min-height: 37rem;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  perspective: 75rem;
}

.phone-frame {
  --phone-rest-y: 1.4rem;
  --phone-rotation-y: 5deg;
  --phone-rotation-z: 0deg;

  position: relative;
  width: min(28%, 12rem);
  padding: .35rem;
  overflow: hidden;
  border: .0625rem solid rgba(var(--v-theme-on-surface), .14);
  border-radius: 1.8rem;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2rem 4rem rgba(0, 0, 0, .34);
  transform: rotateY(var(--phone-rotation-y)) rotateZ(var(--phone-rotation-z)) translateY(var(--phone-rest-y));
  transition: transform 200ms cubic-bezier(.22, 1, .36, 1);
}

.phone-frame:first-child {
  --phone-rest-y: 2.2rem;
  --phone-rotation-y: 8deg;
  --phone-rotation-z: -3deg;
}

.phone-frame:last-child {
  --phone-rest-y: 2.2rem;
  --phone-rotation-y: -8deg;
  --phone-rotation-z: 3deg;
}

.phone-frame--featured {
  --phone-rest-y: -1.2rem;
  --phone-rotation-y: 0deg;
  --phone-rotation-z: 0deg;

  width: min(32%, 13.5rem);
  z-index: 1;
  border-color: rgba(var(--v-theme-secondary), .48);
  box-shadow: 0 2.5rem 5rem rgba(0, 0, 0, .46), 0 0 0 .1rem rgba(var(--v-theme-secondary), .12);
}

.phone-frame:hover {
  transform: rotateY(var(--phone-rotation-y)) rotateZ(var(--phone-rotation-z)) translateY(calc(var(--phone-rest-y) - .55rem));
}

.phone-frame > :is(img, video) {
  width: 100%;
  height: auto;
  aspect-ratio: 57 / 113;
  display: block;
  border-radius: 1.45rem;
  object-fit: cover;
  object-position: center 53.333%;
}

.feature-section {
  padding-block: 8rem;
}

.section-intro {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 3rem;
}

.section-intro h2,
.closing-card h2 {
  font-size: clamp(2.6rem, 4vw, 4.5rem);
}

.section-intro p {
  max-width: 28rem;
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: 1rem;
  line-height: 1.6;
}

.feature-icon {
  width: 3.25rem;
  height: 3.25rem;
  display: grid;
  place-items: center;
  border-radius: 1rem;
  background: rgba(var(--v-theme-secondary), .12);
  color: rgb(var(--v-theme-secondary));
}

.app-section-grid {
  margin-inline: -.5rem;
}

.app-section-col {
  min-width: 0;
  padding: .5rem;
}

.app-section-card {
  display: flex;
  min-height: 20.5rem;
  flex-direction: column;
  background:
    linear-gradient(150deg, rgba(var(--v-theme-secondary), .045), transparent 48%),
    rgb(var(--v-theme-surface));
}

.app-section-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.app-section-card__number {
  color: rgb(var(--v-theme-on-surface) / .24);
  font-size: .72rem;
  font-weight: 900;
  letter-spacing: .1em;
}

.app-section-card__role {
  color: rgb(var(--v-theme-secondary));
  font-size: .7rem;
  font-weight: 900;
  letter-spacing: .12em;
  line-height: 1.2;
  text-transform: uppercase;
}

.app-section-card h3 {
  font-size: 1.25rem;
  font-weight: 900;
  letter-spacing: -.02em;
}

.app-section-card__description {
  flex: 1;
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: .86rem;
  line-height: 1.6;
}

.app-section-card__connection {
  display: flex;
  align-items: flex-start;
  gap: .5rem;
  padding-top: 1rem;
  border-top: .0625rem solid rgba(var(--v-theme-on-surface), .08);
  color: rgb(var(--v-theme-on-surface) / .72);
  font-size: .75rem;
  font-weight: 700;
  line-height: 1.45;
}

.app-section-card__connection .v-icon {
  flex: 0 0 auto;
  margin-top: .08rem;
  color: rgb(var(--v-theme-secondary));
}

.system-flow {
  display: grid;
  grid-template-columns: minmax(17rem, .8fr) minmax(0, 1.2fr);
  align-items: center;
  gap: 2rem;
  border-color: rgba(var(--v-theme-secondary), .2);
  background:
    linear-gradient(105deg, rgba(var(--v-theme-secondary), .09), transparent 42%),
    rgb(var(--v-theme-surface));
}

.system-flow__intro {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 1rem;
}

.system-flow__loop {
  width: 3rem;
  height: 3rem;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: .9rem;
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
}

.system-flow__intro strong {
  font-size: .95rem;
  font-weight: 900;
}

.system-flow__intro p {
  margin-top: .2rem;
  color: rgb(var(--v-theme-on-surface) / .58);
  font-size: .78rem;
  line-height: 1.5;
}

.system-flow__steps {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: .4rem;
}

.system-flow__step {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: .4rem;
  color: rgb(var(--v-theme-on-surface) / .82);
  font-size: .74rem;
  font-weight: 850;
  white-space: nowrap;
}

.system-flow__step .v-icon,
.system-flow__arrow,
.system-flow__return {
  color: rgb(var(--v-theme-secondary));
}

.system-flow__arrow {
  flex: 0 0 auto;
  opacity: .55;
}

.system-flow__return {
  flex: 0 0 auto;
  margin-left: .1rem;
}

.learning-section {
  padding-block: 2rem 8rem;
}

.learning-card {
  overflow: hidden;
  border-color: rgba(var(--v-theme-secondary), .18);
  background:
    radial-gradient(circle at 15% 35%, rgba(var(--v-theme-secondary), .1), transparent 32rem),
    rgb(var(--v-theme-surface));
}

.learning-grid {
  position: relative;
  z-index: 1;
}

.learning-visual {
  display: flex;
  justify-content: center;
}

.learning-phone {
  width: min(100%, 16.25rem);
  padding: .4rem;
  overflow: hidden;
  border: .0625rem solid rgba(var(--v-theme-secondary), .42);
  border-radius: 2rem;
  background: rgb(var(--v-theme-background));
  box-shadow: 0 2rem 4rem rgba(0, 0, 0, .4), 0 0 0 .1rem rgba(var(--v-theme-secondary), .08);
  transform: rotate(-2deg);
}

.learning-phone img {
  width: 100%;
  aspect-ratio: 57 / 113;
  display: block;
  border-radius: 1.6rem;
  object-fit: cover;
  object-position: center 53.333%;
}

.learning-copy {
  padding-left: clamp(1.5rem, 4vw, 4.5rem);
}

.learning-heading h2 {
  max-width: 14ch;
  font-size: clamp(2.6rem, 4vw, 4.5rem);
  font-weight: 900;
  letter-spacing: -.055em;
  line-height: .98;
}

.learning-heading > p {
  max-width: 43rem;
  color: rgb(var(--v-theme-on-surface) / .66);
  font-size: 1rem;
  line-height: 1.65;
}

.learning-flow {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1rem;
}

.learning-step {
  min-width: 0;
}

.learning-step__marker {
  width: 2.75rem;
  height: 2.75rem;
  display: grid;
  place-items: center;
  border: .0625rem solid rgba(var(--v-theme-secondary), .22);
  border-radius: .875rem;
  background: rgba(var(--v-theme-secondary), .1);
  color: rgb(var(--v-theme-secondary));
}

.learning-step__label {
  display: flex;
  min-height: 2.5rem;
  align-items: center;
  justify-content: space-between;
  gap: .25rem;
  margin-top: .75rem;
  color: rgb(var(--v-theme-on-surface));
  font-size: .78rem;
  font-weight: 900;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.learning-step__arrow {
  flex: 0 0 auto;
  color: rgb(var(--v-theme-secondary) / .58);
}

.learning-step__copy p {
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .78rem;
  line-height: 1.55;
}

.learning-loop {
  max-width: 43rem;
  display: flex;
  align-items: flex-start;
  gap: .75rem;
  padding: 1rem 1.125rem;
  border: .0625rem solid rgba(var(--v-theme-secondary), .18);
  border-radius: 1rem;
  background: rgba(var(--v-theme-secondary), .07);
}

.learning-loop p {
  color: rgb(var(--v-theme-on-surface) / .68);
  font-size: .85rem;
  line-height: 1.55;
}

.learning-loop strong {
  color: rgb(var(--v-theme-on-surface));
}

.closing-section {
  padding-block: 3rem 8rem;
}

.closing-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 3rem;
  overflow: hidden;
  border: .0625rem solid rgba(var(--v-theme-secondary), .24);
  background: linear-gradient(125deg, rgb(var(--v-theme-surface)), rgba(var(--v-theme-secondary), .08)) !important;
  box-shadow: 0 1.75rem 4rem rgba(0, 0, 0, .28) !important;
}

.closing-card p {
  color: rgb(var(--v-theme-on-surface) / .62);
}

.landing-footer {
  display: flex;
  min-height: 7rem;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  border-top: .0625rem solid rgba(var(--v-theme-on-surface), .08);
  color: rgb(var(--v-theme-on-surface) / .5);
  font-size: .8rem;
  font-weight: 700;
}

@media (max-width: 79.998rem) {
  .phone-gallery {
    min-height: 32rem;
  }
}

@media (max-width: 79.998rem) and (min-width: 60rem) {
  .hero-copy h1 {
    font-size: 3.9rem;
  }
}

@media (max-width: 59.998rem) {
  .hero-section {
    padding-top: 3rem;
  }

  .hero-copy {
    text-align: center;
  }

  .hero-copy h1,
  .hero-copy > p {
    margin-inline: auto;
  }

  .hero-actions,
  .hero-points {
    justify-content: center;
  }

  .phone-gallery {
    min-height: 31rem;
  }

  .section-intro,
  .closing-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .learning-copy {
    padding-left: 1.5rem;
  }

  .learning-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .learning-step__arrow {
    display: none;
  }

  .system-flow {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  .system-flow__steps {
    justify-content: flex-start;
  }
}

@media (max-width: 47.998rem) {
  .landing-header {
    min-height: 5.5rem;
    align-items: center;
    flex-direction: row;
    gap: .25rem;
    padding-block: 1.25rem;
  }

  .landing-brand img {
    width: 7.5rem;
  }

  .landing-header__actions {
    width: auto;
    margin-left: auto;
  }

  .landing-header__actions :deep(.v-btn) {
    min-width: 0;
    flex: 0 0 auto;
    padding-inline: .625rem;
  }

  .landing-header__web-action {
    display: none;
  }

  .hero-section {
    min-height: auto;
  }

  .hero-section,
  .feature-section,
  .learning-section,
  .closing-section {
    padding-block: 2rem;
  }

  .hero-copy h1 {
    font-size: clamp(2.75rem, 10vw, 3.75rem);
  }

  .app-section-card {
    min-height: auto;
  }

  .system-flow__intro {
    align-items: flex-start;
  }

  .system-flow__steps {
    align-items: flex-start;
    flex-direction: column;
    gap: .35rem;
    padding-left: .9rem;
  }

  .system-flow__arrow {
    margin-left: .05rem;
    transform: rotate(90deg);
  }

  .system-flow__return {
    display: none;
  }

  .phone-gallery {
    min-height: auto;
    padding-bottom: 2rem;
    padding-top: 1rem;
  }

  .phone-frame {
    width: 29%;
    border-radius: 1.4rem;
  }

  .phone-frame--featured {
    width: 34%;
  }

  .phone-frame > :is(img, video) {
    border-radius: 1.1rem;
  }

  .learning-card {
    background:
      radial-gradient(circle at 50% 10%, rgba(var(--v-theme-secondary), .1), transparent 26rem),
      rgb(var(--v-theme-surface));
  }

  .learning-phone {
    width: min(72%, 14rem);
    border-radius: 1.6rem;
    transform: none;
  }

  .learning-phone img {
    border-radius: 1.3rem;
  }

  .learning-copy {
    padding-left: .75rem;
  }

  .learning-heading {
    text-align: center;
  }

  .learning-heading h2,
  .learning-heading > p {
    margin-inline: auto;
  }

  .learning-heading h2 {
    font-size: clamp(2.35rem, 10vw, 3.25rem);
  }

  .learning-flow {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .learning-step {
    position: relative;
    display: grid;
    grid-template-columns: 2.75rem minmax(0, 1fr);
    gap: .875rem;
    padding-bottom: 1rem;
  }

  .learning-step:not(:last-child)::after {
    position: absolute;
    top: 2.75rem;
    bottom: 0;
    left: 1.34375rem;
    width: .0625rem;
    background: rgba(var(--v-theme-secondary), .25);
    content: '';
  }

  .learning-step__label {
    min-height: auto;
    justify-content: flex-start;
    margin-top: .1rem;
    margin-bottom: .25rem;
  }

  .landing-footer {
      min-height: 5rem;
  }

}
</style>
