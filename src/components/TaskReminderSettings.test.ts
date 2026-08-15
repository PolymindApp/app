import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskReminderSettings from '@/components/TaskReminderSettings.vue'

const reminderMocks = vi.hoisted(() => ({
  checkCapabilities: vi.fn(),
  openCapabilitySettings: vi.fn(),
}))

vi.mock('@/services/taskReminders', () => ({
  checkTaskReminderCapabilities: reminderMocks.checkCapabilities,
  openTaskReminderCapabilitySettings: reminderMocks.openCapabilitySettings,
}))

const passthrough = { template: '<div><slot /></div>' }
const VSwitchStub = defineComponent({
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue'],
  template: '<button class="switch" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />',
})
const VBtnStub = defineComponent({
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>',
})
const TimerWheelPickerStub = defineComponent({
  props: { modelValue: [String, Number], mode: String },
  emits: ['update:modelValue'],
  template: '<button class="time-wheel" @click="$emit(\'update:modelValue\', \'07:30\')">{{ modelValue }}</button>',
})

function mountSettings(enabled = false, times: string[] = [], available = true) {
  return mount(TaskReminderSettings, {
    props: { enabled, times, available },
    global: {
      stubs: {
        VAlert: passthrough,
        VBtn: VBtnStub,
        VCard: passthrough,
        ExpandTransition: passthrough,
        VExpandTransition: passthrough,
        VSwitch: VSwitchStub,
        TimerWheelPicker: TimerWheelPickerStub,
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  reminderMocks.checkCapabilities.mockResolvedValue([])
  reminderMocks.openCapabilitySettings.mockResolvedValue(undefined)
})

describe('TaskReminderSettings', () => {
  it('creates the first notification when reminders are enabled', async () => {
    const wrapper = mountSettings()

    await wrapper.get('.switch').trigger('click')

    expect(wrapper.emitted('update:times')).toEqual([[['20:00']]])
    expect(wrapper.emitted('update:enabled')).toEqual([[true]])
    expect(reminderMocks.checkCapabilities).toHaveBeenCalledOnce()
  })

  it('adds, edits, and removes notification times', async () => {
    const wrapper = mountSettings(true, ['08:00', '09:00'])

    const addButton = wrapper.findAll('button').find(button => button.text() === 'Add notification')
    await addButton?.trigger('click')
    expect(wrapper.emitted('update:times')?.at(-1)).toEqual([['08:00', '09:00', '10:00']])

    await wrapper.findAll('.time-wheel')[1]?.trigger('click')
    expect(wrapper.emitted('update:times')?.at(-1)).toEqual([['08:00', '07:30']])
    expect(reminderMocks.checkCapabilities).toHaveBeenCalledTimes(2)

    await wrapper.get('[aria-label="Remove notification 1"]').trigger('click')
    expect(wrapper.emitted('update:times')?.at(-1)).toEqual([['09:00']])
  })

  it('explains availability and disables reminders outside Android', () => {
    const wrapper = mountSettings(false, [], false)

    expect(wrapper.text()).toContain('Reminders are available in the Android app.')
    expect(wrapper.get('.switch').attributes()).toHaveProperty('disabled')
  })

  it('shows missing capabilities and rechecks after returning from settings', async () => {
    reminderMocks.checkCapabilities.mockResolvedValueOnce([{
      code: 'do_not_disturb',
      message: 'Do Not Disturb is silencing task reminders. Allow BackOnTrack under Apps.',
      action: 'Allow during Do Not Disturb',
    }]).mockResolvedValueOnce([])
    const wrapper = mountSettings(true, ['08:00'])

    await wrapper.get('.time-wheel').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Do Not Disturb is silencing task reminders.')
    const settingsButton = wrapper.findAll('button')
      .find(button => button.text() === 'Allow during Do Not Disturb')
    await settingsButton?.trigger('click')
    await flushPromises()

    expect(reminderMocks.openCapabilitySettings).toHaveBeenCalledWith('do_not_disturb')
    expect(reminderMocks.checkCapabilities).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('Reminder setup needs attention')
  })
})
