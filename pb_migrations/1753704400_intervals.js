migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
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

  const templates = new Collection({
    type: 'base',
    name: 'interval_templates',
    ...ownerRules,
    fields: [
      ownerRelation(),
      { type: 'text', name: 'name', required: true, max: 160 },
      { type: 'text', name: 'description', max: 2000 },
      { type: 'text', name: 'color', required: true, max: 20 },
      { type: 'json', name: 'definition', required: true, maxSize: 2000000 },
      { type: 'bool', name: 'sound_enabled' },
      { type: 'bool', name: 'vibration_enabled' },
      { type: 'select', name: 'sound', required: true, maxSelect: 1, values: ['beep', 'bell', 'soft'] },
      { type: 'number', name: 'sort_order', min: 0, onlyInt: true },
    ],
    indexes: ['CREATE INDEX idx_interval_templates_owner_order ON interval_templates (owner, sort_order)'],
  })
  app.save(templates)

  const sessions = new Collection({
    type: 'base',
    name: 'interval_sessions',
    ...ownerRules,
    fields: [
      ownerRelation(),
      { type: 'relation', name: 'template', maxSelect: 1, collectionId: templates.id, cascadeDelete: false },
      { type: 'select', name: 'source', required: true, maxSelect: 1, values: ['template', 'quick'] },
      { type: 'select', name: 'status', required: true, maxSelect: 1, values: ['running', 'paused', 'completed', 'ended'] },
      { type: 'text', name: 'snapshot_name', required: true, max: 160 },
      { type: 'json', name: 'definition_snapshot', required: true, maxSize: 2000000 },
      { type: 'json', name: 'cue_snapshot', required: true, maxSize: 2000 },
      { type: 'date', name: 'started_at', required: true },
      { type: 'date', name: 'ended_at' },
      { type: 'number', name: 'planned_seconds', min: 0 },
      { type: 'number', name: 'elapsed_seconds', min: 0 },
      { type: 'json', name: 'runtime_state', required: true, maxSize: 20000 },
    ],
    indexes: [
      'CREATE INDEX idx_interval_sessions_owner_started ON interval_sessions (owner, started_at)',
      'CREATE INDEX idx_interval_sessions_owner_status ON interval_sessions (owner, status)',
    ],
  })
  app.save(sessions)
}, (app) => {
  for (const name of ['interval_sessions', 'interval_templates']) {
    try {
      app.delete(app.findCollectionByNameOrId(name))
    } catch (_) {
      // Collection may already be absent during a partial rollback.
    }
  }
})
