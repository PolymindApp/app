migrate((app) => {
  const collection = app.findCollectionByNameOrId('program_steps')
  collection.fields.add(new BoolField({ name: 'active' }))
  app.save(collection)
  app.db().newQuery('UPDATE program_steps SET active = 1').execute()
}, (app) => {
  const collection = app.findCollectionByNameOrId('program_steps')
  collection.fields.removeByName('active')
  app.save(collection)
})
