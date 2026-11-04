import { getJupyterNotebook } from '../get-jupyter-notebook.js'
import { handleErrorResponse } from '../lib/util.js'

/**
 * GET /kubernetes/jupyter
 *
 * The requesting user's Jupyter notebook state and user folder volume
 * statistics. Scoped to the caller: the JupyterHub username is resolved
 * from the Directus user's Keycloak identity (external_identifier →
 * Keycloak username; the hub usernames match, the same mapping the
 * reservations-watcher relies on). A user therefore only ever sees
 * their own notebook — admins included.
 */
export async function getJupyterNotebookRoute(ctx) {
  const { res } = ctx
  const { client, user } = ctx
  if (!user?.external_identifier || !client) {
    // Without a Keycloak identity there is no JupyterHub user to look up
    res.status(404)
    return { message: 'api_errors.not_found' }
  }
  try {
    const { data: keycloakUser } = await client.get(
      `/users/${user.external_identifier}`
    )
    if (!keycloakUser?.username) {
      res.status(404)
      return { message: 'api_errors.not_found' }
    }
    return await getJupyterNotebook(keycloakUser.username)
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
