import { COLLECTIONS } from './lib/constants.js'
import { declaredPorts, makeNetworkPolicy } from './lib/make-network-policy.js'
import { makeHeadlessService } from './lib/make-service.js'
import { getDeploymentName } from './lib/util.js'
import { parse } from 'yaml'
import { createNetworkPolicy } from './create-network-policy.js'
import { createService } from './create-service.js'

/**
 * Read every deployment item with the fields the isolation policies are
 * derived from. Runs with system-level accountability: the sync must see
 * all deployments regardless of the requesting user's rights.
 */
async function loadAllDeployments(services, schema) {
  const deploymentsService = new services.ItemsService(
    COLLECTIONS.deployments,
    { schema, accountability: null }
  )
  return deploymentsService.readByQuery({
    fields: ['id', 'data'],
    limit: -1,
  })
}

/**
 * Declared service ports of a deployment item, parsed from its YAML data.
 * Unparseable data yields no port restrictions (the deployment must have
 * parsed to be deployed at all — this is a safety net, and it fails open
 * to avoid cutting off a running service).
 */
function portsOfDeployment(deployment) {
  try {
    const data = parse(deployment?.data)
    return declaredPorts(
      (data?.containers || []).map((c) => ({ name: c.name, ports: c.ports }))
    )
  } catch {
    return []
  }
}

/**
 * Create or update the isolation resources of the given deployments:
 * the per-deployment NetworkPolicy (ingress + egress) and the headless
 * service backing cross-deployment DNS. Each policy is derived entirely
 * from the deployment's own item (id and declared ports) and idempotent —
 * nothing here touches pods, so no deployment is restarted.
 *
 * The Directus `status` (e.g. `draft`) does not participate: it only
 * controls visibility in the services overview.
 *
 * @param {Array} deployments all deployment items
 * @param {Array} targets subset of items to sync (defaults to all)
 * @returns {{policies: number, headlessServices: number}}
 */
export async function syncNetworkPolicies(services, schema, deployments, targets) {
  const items = targets ?? deployments ?? []
  let policies = 0
  let headlessServices = 0
  for (const deployment of items) {
    const statefulSetName = getDeploymentName(deployment.id)
    await createNetworkPolicy(
      makeNetworkPolicy(statefulSetName, {
        ports: portsOfDeployment(deployment),
      }),
      statefulSetName
    )
    policies += 1
    await createService(
      makeHeadlessService(statefulSetName),
      statefulSetName
    )
    headlessServices += 1
  }
  return { policies, headlessServices }
}

/**
 * Regenerate the isolation resources of the given deployment ids. Each
 * deployment's policy depends only on its own item, so syncing exactly
 * the changed items is sufficient.
 *
 * @param {object} services Directus services (from the extension context)
 * @param {object} schema request schema
 * @param {Array} ids deployment item ids
 */
export async function syncDeploymentIds(services, schema, ids) {
  const deployments = await loadAllDeployments(services, schema)
  const wanted = new Set((ids ?? []).map((id) => String(id)))
  const targets = deployments.filter((deployment) =>
    wanted.has(String(deployment.id))
  )
  return syncNetworkPolicies(services, schema, deployments, targets)
}

/**
 * Backfill the isolation resources of EVERY deployment. Idempotent and
 * safe to re-run; used to migrate existing deployments without touching
 * their pods (no restarts). Intended for administrators via the backfill
 * endpoint — e.g. once after the initial rollout, and whenever a new
 * system-internal service is added to SYSTEM_APP_LABEL_VALUES.
 */
export async function backfillNetworkPolicies(services, schema) {
  const deployments = await loadAllDeployments(services, schema)
  return syncNetworkPolicies(services, schema, deployments)
}
