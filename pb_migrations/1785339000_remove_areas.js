migrate((app) => {
  const tasks = app.findCollectionByNameOrId('tasks')
  tasks.fields.removeByName('area')
  app.save(tasks)
  app.delete(app.findCollectionByNameOrId('areas'))
}, (app) => {
  const users = app.findCollectionByNameOrId('users')
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
      { type: 'relation', name: 'owner', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { type: 'text', name: 'name', required: true, max: 80 },
      { type: 'text', name: 'color', required: true, max: 20 },
      { type: 'text', name: 'icon', required: true, max: 80 },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_areas_owner_name ON areas (owner, name)'],
  })
  app.save(areas)

  const tasks = app.findCollectionByNameOrId('tasks')
  tasks.fields.add(new RelationField({
    name: 'area',
    maxSelect: 1,
    collectionId: areas.id,
    cascadeDelete: false,
  }))
  app.save(tasks)
})
