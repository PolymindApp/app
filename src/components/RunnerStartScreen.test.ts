import { flushPromises, mount } from '@vue/test-utils'
import RunnerStartScreen from '@/components/RunnerStartScreen.vue'

describe('RunnerStartScreen', () => {
  it('shrinks the title when its longest word exceeds the available width', async () => {
    const wrapper = mount(RunnerStartScreen, {
      props: {
        title: 'Extraordinarilylongword Review',
        summary: '12 cards',
        icon: 'mdi-cards-playing-outline',
        primaryLabel: 'Start review',
        backLabel: 'Back to flashcards',
      },
      global: { stubs: { VBtn: true, VIcon: true } },
    })
    const title = wrapper.get('.runner-start-screen__title')
    Object.defineProperty(title.element, 'clientWidth', { configurable: true, value: 200 })
    for (const word of wrapper.findAll('.runner-start-screen__word')) {
      Object.defineProperty(word.element, 'scrollWidth', {
        configurable: true,
        value: word.text().startsWith('Extraordinarily') ? 400 : 100,
      })
    }
    const computedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation(element => ({
      fontSize: element === document.documentElement ? '16px' : '96px',
    }) as CSSStyleDeclaration)

    window.dispatchEvent(new Event('resize'))
    await flushPromises()

    expect(title.attributes('style')).toContain('font-size: 2.94rem')

    computedStyle.mockRestore()
    wrapper.unmount()
  })
})
