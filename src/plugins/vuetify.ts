import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'

export const vuetify = createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  defaults: {
    VBtn: {
      rounded: 'lg',
      class: 'text-none font-weight-bold',
    },
    VCard: {
      rounded: 'xl',
      elevation: 0,
    },
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VNumberInput: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VSelect: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VTextarea: {
      hideDetails: 'auto',
    },
    VDialog: {
      transition: 'fade-transition',
    },
  },
  theme: {
    defaultTheme: 'forgeLight',
    themes: {
      forgeLight: {
        dark: false,
        colors: {
          background: '#F2F2ED',
          surface: '#FFFFFF',
          'surface-variant': '#E7E8E1',
          primary: '#191C19',
          secondary: '#C7F464',
          success: '#4A7D44',
          warning: '#E49A3A',
          error: '#D95C4F',
          info: '#5278A3',
          'on-background': '#191C19',
          'on-surface': '#191C19',
          'on-primary': '#FFFFFF',
          'on-secondary': '#192113',
        },
      },
      forgeDark: {
        dark: true,
        colors: {
          background: '#101310',
          surface: '#1A1E1A',
          'surface-variant': '#292E28',
          primary: '#F1F4EC',
          secondary: '#C7F464',
          success: '#79C174',
          warning: '#F0AB50',
          error: '#FF776B',
          info: '#8FB8FF',
          'on-background': '#F1F4EC',
          'on-surface': '#F1F4EC',
          'on-primary': '#111411',
          'on-secondary': '#17200F',
        },
      },
    },
  },
})
