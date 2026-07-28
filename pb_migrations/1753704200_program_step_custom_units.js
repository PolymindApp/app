migrate((app) => {
  const collection = app.findCollectionByNameOrId('program_steps')
  collection.fields.add(new TextField({ name: 'custom_unit', max: 30 }))
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('program_steps')
  collection.fields.removeByName('custom_unit')
  app.save(collection)
})
