migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  users.listRule = 'id = @request.auth.id'
  users.viewRule = 'id = @request.auth.id'
  users.createRule = ''
  users.updateRule = 'id = @request.auth.id'
  users.deleteRule = 'id = @request.auth.id'
  users.fields.add(new TextField({ name: 'timezone', required: true, max: 80 }))
  app.save(users)

  const ownerRelation = () => ({
    type: 'relation',
    name: 'owner',
    required: true,
    maxSelect: 1,
    collectionId: users.id,
    cascadeDelete: true,
  })
  const ownerRules = {
    listRule: 'owner = @request.auth.id',
    viewRule: 'owner = @request.auth.id',
    createRule: '@request.auth.id != "" && owner = @request.auth.id',
    updateRule: 'owner = @request.auth.id',
    deleteRule: 'owner = @request.auth.id',
  }

  const areas = new Collection({
    type: 'base',
    name: 'areas',
    ...ownerRules,
    fields: [
      ownerRelation(),
      { type: 'text', name: 'name', required: true, max: 80 },
      { type: 'text', name: 'color', required: true, max: 20 },
      { type: 'text', name: 'icon', required: true, max: 60 },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_areas_owner_name ON areas (owner, name)'],
  })
  app.save(areas)

  const tags = new Collection({
    type: 'base',
    name: 'tags',
    ...ownerRules,
    fields: [ownerRelation(), { type: 'text', name: 'name', required: true, max: 50 }],
    indexes: ['CREATE UNIQUE INDEX idx_tags_owner_name ON tags (owner, name)'],
  })
  app.save(tags)

  const tasks = new Collection({
    type: 'base',
    name: 'tasks',
    ...ownerRules,
    fields: [
      ownerRelation(),
      { type: 'text', name: 'name', required: true, max: 160 },
      { type: 'text', name: 'description', max: 2000 },
      { type: 'select', name: 'type', required: true, maxSelect: 1, values: ['check', 'duration', 'daily_total', 'program'] },
      { type: 'relation', name: 'area', maxSelect: 1, collectionId: areas.id, cascadeDelete: false },
      { type: 'relation', name: 'tags', maxSelect: 12, collectionId: tags.id, cascadeDelete: false },
      { type: 'bool', name: 'mandatory' },
      { type: 'bool', name: 'review_when_missed' },
      { type: 'bool', name: 'active' },
      { type: 'text', name: 'start_date', required: true, max: 10 },
      { type: 'text', name: 'end_date', max: 10 },
      { type: 'select', name: 'recurrence_type', required: true, maxSelect: 1, values: ['daily', 'weekdays', 'interval_weeks'] },
      { type: 'json', name: 'weekdays', maxSize: 1000 },
      { type: 'number', name: 'interval_weeks', min: 1, max: 52, onlyInt: true },
      { type: 'number', name: 'target_value', min: 0 },
      { type: 'select', name: 'target_operator', maxSelect: 1, values: ['gte', 'lte', 'eq'] },
      { type: 'text', name: 'unit', max: 30 },
      { type: 'text', name: 'custom_unit', max: 30 },
      { type: 'select', name: 'goal_period', maxSelect: 1, values: ['occurrence', 'week'] },
      { type: 'json', name: 'quick_amounts', maxSize: 1000 },
      { type: 'number', name: 'cycle_length', min: 0, max: 365, onlyInt: true },
      { type: 'bool', name: 'program_repeat' },
      { type: 'bool', name: 'program_strict' },
      { type: 'number', name: 'sort_order', onlyInt: true },
    ],
    indexes: ['CREATE INDEX idx_tasks_owner_active ON tasks (owner, active)'],
  })
  app.save(tasks)

  const programSteps = new Collection({
    type: 'base',
    name: 'program_steps',
    ...ownerRules,
    fields: [
      ownerRelation(),
      { type: 'relation', name: 'task', required: true, maxSelect: 1, collectionId: tasks.id, cascadeDelete: true },
      { type: 'text', name: 'name', required: true, max: 160 },
      { type: 'text', name: 'description', max: 2000 },
      { type: 'number', name: 'sort_order', min: 0, onlyInt: true },
      { type: 'json', name: 'cycle_days', required: true, maxSize: 2000 },
      { type: 'select', name: 'completion_type', required: true, maxSelect: 1, values: ['check', 'quantity'] },
      { type: 'number', name: 'target_value', min: 0 },
      { type: 'select', name: 'target_operator', maxSelect: 1, values: ['gte', 'lte', 'eq'] },
      { type: 'text', name: 'unit', max: 30 },
      { type: 'json', name: 'quick_amounts', maxSize: 1000 },
    ],
    indexes: ['CREATE INDEX idx_program_steps_task_order ON program_steps (task, sort_order)'],
  })
  app.save(programSteps)

  const occurrences = new Collection({
    type: 'base',
    name: 'occurrences',
    ...ownerRules,
    fields: [
      ownerRelation(),
      { type: 'relation', name: 'task', required: true, maxSelect: 1, collectionId: tasks.id, cascadeDelete: true },
      { type: 'relation', name: 'program_step', maxSelect: 1, collectionId: programSteps.id, cascadeDelete: true },
      { type: 'text', name: 'scheduled_date', required: true, max: 10 },
      { type: 'select', name: 'status', required: true, maxSelect: 1, values: ['pending', 'completed', 'missed', 'carried', 'rescheduled'] },
      { type: 'date', name: 'completed_at' },
      { type: 'text', name: 'snapshot_name', required: true, max: 160 },
      { type: 'number', name: 'snapshot_target', min: 0 },
      { type: 'text', name: 'snapshot_unit', max: 30 },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_occurrences_unique ON occurrences (task, program_step, scheduled_date)',
      'CREATE INDEX idx_occurrences_owner_date ON occurrences (owner, scheduled_date)',
    ],
  })
  app.save(occurrences)

  const entries = new Collection({
    type: 'base',
    name: 'entries',
    ...ownerRules,
    fields: [
      ownerRelation(),
      { type: 'relation', name: 'task', required: true, maxSelect: 1, collectionId: tasks.id, cascadeDelete: true },
      { type: 'relation', name: 'occurrence', maxSelect: 1, collectionId: occurrences.id, cascadeDelete: true },
      { type: 'relation', name: 'program_step', maxSelect: 1, collectionId: programSteps.id, cascadeDelete: true },
      { type: 'text', name: 'entry_date', required: true, max: 10 },
      { type: 'number', name: 'value' },
      { type: 'select', name: 'kind', required: true, maxSelect: 1, values: ['duration', 'quantity', 'adjustment'] },
      { type: 'text', name: 'unit', max: 30 },
      { type: 'text', name: 'note', max: 1000 },
    ],
    indexes: ['CREATE INDEX idx_entries_owner_date ON entries (owner, entry_date)'],
  })
  app.save(entries)
}, (app) => {
  for (const name of ['entries', 'occurrences', 'program_steps', 'tasks', 'tags', 'areas']) {
    try {
      app.delete(app.findCollectionByNameOrId(name))
    } catch (_) {
      // Collection may already be absent during a partial rollback.
    }
  }
  const users = app.findCollectionByNameOrId('users')
  users.fields.removeByName('timezone')
  app.save(users)
})
