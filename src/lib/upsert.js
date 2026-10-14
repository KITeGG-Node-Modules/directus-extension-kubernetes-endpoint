const NOT_FOUND = 404
const CONFLICT = 409

function hasStatus(err, status) {
  return err?.statusCode === status || err?.body?.code === status
}

/**
 * Create or update a Kubernetes resource, tolerating concurrent requests.
 *
 * Reads the current resource first: creates it when missing, otherwise
 * updates it. A 409 on create (a concurrent request won the race) falls
 * back to the update path instead of failing.
 *
 * The read result is passed to the update callback (null when the resource
 * did not exist yet or when the read lost the create race) so the update
 * can preserve fields of the existing resource.
 *
 * Returns { created: true } when the resource was newly created.
 */
export async function upsert({ read, create, update }) {
  let exists = true
  let current = null
  try {
    current = await read()
  } catch (err) {
    if (!hasStatus(err, NOT_FOUND)) throw err
    exists = false
  }
  if (!exists) {
    try {
      await create()
      return { created: true }
    } catch (err) {
      if (!hasStatus(err, CONFLICT)) throw err
      // Lost the create race against a concurrent request: update instead
    }
  }
  await update(current)
  return { created: false }
}
