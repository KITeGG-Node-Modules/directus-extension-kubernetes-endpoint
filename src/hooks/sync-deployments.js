import { backfillNetworkPolicies, syncDeploymentIds } from '../sync-network-policies.js'

// Coalesce bursts of item edits (e.g. saving a deployment fires one action
// per mutation) into a single sync
const SYNC_DEBOUNCE_MS = 2000

// Periodic full reconciliation as a safety net for everything the item
// hooks cannot see: resources edited out-of-band with kubectl, or drift
const RECONCILE_CRON = '*/10 * * * *'

/**
 * Regenerates the isolation NetworkPolicies whenever a deployment item is
 * changed in Directus, so edits are reflected without waiting for the
 * next deploy:
 *
 * - `deployments.items.update` / `.create`: debounced sync of exactly the
 *   edited deployments (each policy depends only on its own item).
 *   Covers port changes in the deployment YAML.
 * - every RECONCILE_CRON: full sync of all deployments.
 *
 * The Directus `status` (e.g. `draft`) does not affect the policies — it
 * only controls visibility in the services overview. The hook never fails
 * the mutation: it runs after the item change and only logs errors. The
 * backfill endpoint remains the manual fallback.
 */
export default function registerHook({ action, schedule }, context) {
  const { services, getSchema } = context

  const pendingIds = new Set()
  let fullSyncPending = false
  let timer = null
  let syncing = false

  async function run() {
    timer = null
    if (syncing) return
    const ids = [...pendingIds]
    const fullSync = fullSyncPending
    pendingIds.clear()
    fullSyncPending = false
    if (!fullSync && ids.length === 0) return
    syncing = true
    try {
      const schema = await getSchema()
      if (fullSync) {
        await backfillNetworkPolicies(services, schema)
      } else {
        await syncDeploymentIds(services, schema, ids)
      }
    } catch (err) {
      console.error('Failed to sync network policies after deployment edit:', err)
    } finally {
      syncing = false
      // Edits that arrived while syncing are still pending
      if (fullSyncPending || pendingIds.size > 0) armTimer()
    }
  }

  function armTimer() {
    if (timer) return
    timer = setTimeout(run, SYNC_DEBOUNCE_MS)
  }

  function scheduleSync(ids) {
    for (const id of ids ?? []) {
      if (id != null) pendingIds.add(String(id))
    }
    armTimer()
  }

  function scheduleFullSync() {
    fullSyncPending = true
    armTimer()
  }

  action('deployments.items.update', ({ keys }) => scheduleSync(keys))
  action('deployments.items.create', ({ key, payload }) =>
    scheduleSync(key != null ? [key] : [payload?.id])
  )
  schedule(RECONCILE_CRON, () => scheduleFullSync())
}
