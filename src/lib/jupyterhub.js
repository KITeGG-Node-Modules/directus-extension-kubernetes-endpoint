// SPDX-License-Identifier: EUPL-1.2
// JupyterHub REST API client for the notebook endpoint. The hub knows
// the user's server state — including the actual pod name in
// `state.pod_name` — which avoids having to reproduce KubeSpawner's
// username escaping for pod/PVC names.

const REQUEST_TIMEOUT_MS = 10_000

/**
 * The user's record from the JupyterHub API:
 * { name, servers: { '': { ready, pending, state: { pod_name } }, ... } }
 * Servers that are fully stopped are absent from the `servers` map.
 * Returns null when the hub does not know the user (never spawned).
 */
export async function getJupyterHubUser(baseUrl, apiToken, username) {
  const url = `${baseUrl.replace(/\/+$/, '')}/hub/api/users/${encodeURIComponent(username)}`
  const response = await fetch(url, {
    headers: { Authorization: `token ${apiToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`JupyterHub API returned HTTP ${response.status}`)
  }
  const payload = await response.json()
  if (!payload?.name) {
    throw new Error('JupyterHub API returned an unexpected payload')
  }
  return payload
}
