<script setup lang="ts">
const features = [
  {
    title: 'Program your routines',
    description: 'Turn an ambition into actions, targets, schedules, or repeating multi-step programs. Choose exactly what done means.',
    icon: 'mdi-clipboard-check-outline',
  },
  {
    title: 'Build every interval',
    description: 'Arrange timed steps and repeatable groups for workouts, focus, recovery, or any routine. Tune the timing, order, repeats, and cues.',
    icon: 'mdi-timer-outline',
  },
  {
    title: 'Tune how you learn',
    description: 'Create or import cards, build focused Review sets, choose the order and pace, and add audio or passive review.',
    icon: 'mdi-cards-outline',
  },
  {
    title: 'Measure your progress',
    description: 'Define the signals that matter, choose scales and targets, add reminders, and compare factors with outcomes.',
    icon: 'mdi-chart-timeline-variant',
  },
  {
    title: 'Connect the full picture',
    description: 'Link reflections to tasks and trackers so your notes add helpful context to your numbers and routines.',
    icon: 'mdi-notebook-outline',
  },
]

const screenshots = [
  {
    title: 'Tasks',
    src: '/images/tasks.jpeg',
    alt: 'Mom Tasks screen showing a weekly plan, completion progress, and programmable targets.',
  },
  {
    title: 'Intervals',
    src: '/images/intervals.jpeg',
    alt: 'Mom Intervals screen running a programmed exercise sequence with timing and repetition progress.',
  },
  {
    title: 'Tracking',
    src: '/images/tracking.jpeg',
    alt: 'Mom Tracking screen showing configurable wellbeing trackers and weekly patterns.',
  },
]
</script>

<template>
  <v-app theme="forgeDark">
    <v-main class="landing-page app-scroll">
      <header class="landing-header px-6 px-lg-10">
        <router-link to="/" class="landing-brand" aria-label="Mom home">
          <img src="/brand/mom-wordmark.png" alt="Mom" />
        </router-link>
        <v-btn color="secondary" size="large" to="/auth" append-icon="mdi-arrow-right">
          Open Mom
        </v-btn>
      </header>

      <main>
        <section class="hero-section px-6 px-lg-10">
          <div class="hero-glow" aria-hidden="true" />
          <v-row class="hero-grid" align="center">
            <v-col cols="12" lg="5" class="hero-copy">
              <h1>Program your life. Your way<span class="text-secondary">.</span></h1>
              <p class="mt-6">
                Management of Me [MOM] turns what matters to you into a system you can fine-tune, from daily actions and multi-step routines to precise timers, learning, tracking, and reflection.
              </p>
              <div class="hero-actions mt-8">
                <v-btn color="secondary" size="x-large" to="/auth" append-icon="mdi-arrow-right">
                  Get started
                </v-btn>
                <a class="feature-link" href="#features">
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

            <v-col cols="12" lg="7">
              <div class="phone-gallery" aria-label="Mom mobile app screenshots">
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
            <h2>Fine-tune every part<span class="text-secondary">.</span></h2>
            <p>Choose the schedule, targets, sequence, timing, and feedback that work for you. Connect each part into one personal system.</p>
          </div>

          <v-row class="feature-grid mt-8">
            <v-col v-for="feature in features" :key="feature.title" cols="12" md="6" lg="4">
              <v-card class="feature-card surface-card pa-6" height="100%">
                <div class="feature-icon mb-5">
                  <v-icon :icon="feature.icon" size="27" />
                </div>
                <h3>{{ feature.title }}</h3>
                <p class="mt-3">{{ feature.description }}</p>
              </v-card>
            </v-col>

            <v-col cols="12" md="6" lg="4">
              <v-card class="feature-card feature-card--summary pa-6" color="secondary" height="100%">
                <div class="feature-icon feature-icon--dark mb-5">
                  <v-icon icon="mdi-account-heart-outline" size="27" />
                </div>
                <h3>Your life, your system</h3>
                <p class="mt-3">Program each part in detail, connect it to the rest, and keep tuning it as your priorities change.</p>
              </v-card>
            </v-col>
          </v-row>
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
        <img src="/brand/mom-wordmark.png" alt="Mom" />
        <span>Management of Me.</span>
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
  position: relative;
  width: min(28%, 12rem);
  aspect-ratio: 57 / 128;
  padding: .35rem;
  overflow: hidden;
  border: .0625rem solid rgba(var(--v-theme-on-surface), .14);
  border-radius: 1.8rem;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2rem 4rem rgba(0, 0, 0, .34);
  transform: rotateY(5deg) translateY(1.4rem);
}

.phone-frame:first-child {
  transform: rotateY(8deg) rotateZ(-3deg) translateY(2.2rem);
}

.phone-frame:last-child {
  transform: rotateY(-8deg) rotateZ(3deg) translateY(2.2rem);
}

.phone-frame--featured {
  width: min(32%, 13.5rem);
  z-index: 1;
  border-color: rgba(var(--v-theme-secondary), .48);
  box-shadow: 0 2.5rem 5rem rgba(0, 0, 0, .46), 0 0 0 .1rem rgba(var(--v-theme-secondary), .12);
  transform: translateY(-1.2rem);
}

.phone-frame__image {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 1.45rem;
  object-fit: cover;
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

.feature-card {
  background: rgb(var(--v-theme-surface));
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

.feature-icon--dark {
  background: rgba(var(--v-theme-on-secondary), .1);
  color: rgb(var(--v-theme-on-secondary));
}

.feature-card h3 {
  font-size: 1.25rem;
  font-weight: 900;
  letter-spacing: -.02em;
}

.feature-card p {
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: .9rem;
  line-height: 1.65;
}

.feature-card--summary {
  color: rgb(var(--v-theme-on-secondary));
}

.feature-card--summary p {
  color: rgb(var(--v-theme-on-secondary) / .72);
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
}

@media (max-width: 47.998rem) {
  .landing-header {
    min-height: 5.5rem;
  }

  .landing-brand img {
    width: 7.25rem;
  }

  .hero-section {
    min-height: auto;
    padding-block: 4rem 5rem;
  }

  .hero-copy h1 {
    font-size: clamp(2.75rem, 10vw, 3.75rem);
  }

  .phone-gallery {
    min-height: 25rem;
  }

  .phone-frame {
    width: 29%;
    border-radius: 1.4rem;
  }

  .phone-frame--featured {
    width: 34%;
  }

  .phone-frame__image {
    border-radius: 1.1rem;
  }

  .feature-section {
    padding-block: 5rem;
  }

  .closing-section {
    padding-bottom: 5rem;
  }
}
</style>
