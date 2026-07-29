migrate((app) => {
  const collection = app.findCollectionByNameOrId('occurrences')
  collection.fields.add(new BoolField({ name: 'sealed' }))
  app.save(collection)
  app.db().newQuery(
    "UPDATE occurrences SET sealed = 1 WHERE status = 'completed'",
  ).execute()
}, (app) => {
  const collection = app.findCollectionByNameOrId('occurrences')
  collection.fields.removeByName('sealed')
  app.save(collection)
})
