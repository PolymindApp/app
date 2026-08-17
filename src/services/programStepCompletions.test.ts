import { describe, expect, it } from 'vitest'
import {
  normalizeProgramStepCompletions,
  programStepCompletionPayload,
} from './programStepCompletions'

describe('program step completions', () => {
  it('preserves mixed ordering and duplicate interval selections', () => {
    const completions = normalizeProgramStepCompletions({
      completion_type: 'check',
      completions: [
        { id: 'check-1', type: 'check' },
        { id: 'interval-1', type: 'interval', intervalTemplate: 'timer-1' },
        {
          id: 'quantity-1',
          type: 'quantity',
          targetValue: 10,
          targetOperator: 'gte',
          unit: 'count',
        },
        { id: 'interval-2', type: 'interval', intervalTemplate: 'timer-1' },
      ],
    })

    expect(programStepCompletionPayload(completions)).toEqual([
      { id: 'check-1', type: 'check' },
      { id: 'interval-1', type: 'interval', intervalTemplate: 'timer-1' },
      {
        id: 'quantity-1',
        type: 'quantity',
        targetValue: 10,
        targetOperator: 'gte',
        unit: 'count',
        customUnit: '',
      },
      { id: 'interval-2', type: 'interval', intervalTemplate: 'timer-1' },
    ])
  })

  it('maps a legacy single-style step to one stable completion', () => {
    expect(normalizeProgramStepCompletions({
      completion_type: 'interval',
      interval_template: 'timer-1',
    })).toEqual([{
      id: 'completion-legacy',
      type: 'interval',
      intervalTemplate: 'timer-1',
    }])
  })
})
