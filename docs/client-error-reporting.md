# Client error reporting

BackOnTrack records failed HTTP requests and resource loads together with uncaught JavaScript, unhandled promise rejection, and Vue application errors. Error details remain in a bounded local queue until the authenticated app sends them in a batch.

Batches are sent every 15 minutes and when the native app moves to the background or the browser page closes. A failed upload stays queued for a later attempt. URL query strings and request bodies are excluded from reports.

Errors with the same type, message, source, HTTP method, and status are counted together both in the client queue and in the server's `client_errors` table. Each row keeps the first and latest occurrence, total count, latest stack, platform, app version, and user agent.
