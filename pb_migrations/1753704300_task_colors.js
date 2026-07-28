migrate((app) => {
  const collection = app.findCollectionByNameOrId('tasks')
  collection.fields.add(new TextField({
    name: 'color',
    max: 20,
    pattern: '^#[0-9A-Fa-f]{6}$',
  }))
  app.save(collection)
  app.db().newQuery("UPDATE tasks SET color = '#C7F464' WHERE color = ''").execute()
}, (app) => {
  const collection = app.findCollectionByNameOrId('tasks')
  collection.fields.removeByName('color')
  app.save(collection)
})
