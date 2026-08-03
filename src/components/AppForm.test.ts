import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import AppForm from '@/components/AppForm.vue'

type ValidationResult = {
  valid: boolean
  errors: Array<{ id: string; errorMessages: string[] }>
}

function createVFormStub(result: ValidationResult) {
  const validate = vi.fn().mockResolvedValue(result)
  const reset = vi.fn()
  const resetValidation = vi.fn()

  const component = defineComponent({
    name: 'VForm',
    emits: ['submit'],
    setup(_, { expose, slots }) {
      expose({ validate, reset, resetValidation })
      return () => h('form', { class: 'v-form' }, slots.default?.())
    },
  })

  return { component, validate }
}

function submitEvent(result: ValidationResult) {
  const validation = Promise.resolve(result)
  return Object.assign(new Event('submit'), {
    then: validation.then.bind(validation),
    catch: validation.catch.bind(validation),
    finally: validation.finally.bind(validation),
  })
}

function mountForm(result: ValidationResult) {
  const vForm = createVFormStub(result)
  const wrapper = mount(AppForm, {
    slots: {
      default: '<div class="v-input v-input--error">Field error</div>',
    },
    global: {
      stubs: { VForm: vForm.component },
    },
  })
  const errorField = wrapper.find<HTMLElement>('.v-input--error').element
  errorField.scrollIntoView = vi.fn()

  return { errorField, vForm, wrapper }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppForm', () => {
  it('smoothly reveals the first field error after explicit validation fails', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as MediaQueryList))
    const result = {
      valid: false,
      errors: [{ id: 'name', errorMessages: ['Name is required'] }],
    }
    const { errorField, wrapper } = mountForm(result)

    await (wrapper.vm as unknown as { validate: () => Promise<ValidationResult> }).validate()

    expect(errorField.scrollIntoView).toHaveBeenCalledOnce()
    expect(errorField.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
  })

  it('also reveals errors from form submission and honors reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList))
    const result = {
      valid: false,
      errors: [{ id: 'email', errorMessages: ['Required'] }],
    }
    const { errorField, vForm, wrapper } = mountForm(result)

    wrapper.findComponent(vForm.component).vm.$emit('submit', submitEvent(result))
    await flushPromises()

    expect(errorField.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'nearest',
    })
  })

  it('does not move the page when validation succeeds', async () => {
    const result = { valid: true, errors: [] }
    const { errorField, wrapper } = mountForm(result)

    await (wrapper.vm as unknown as { validate: () => Promise<ValidationResult> }).validate()

    expect(errorField.scrollIntoView).not.toHaveBeenCalled()
  })
})
