import { COLLECTIONS } from './lib/constants.js'
import { deploymentAuthorsField } from './lib/config.js'
import { peerDeploymentNames } from './lib/deployment-peers.js'
import {
  declaredPorts,
  exposedPortsOf,
  makeNetworkPolicy,
} from './lib/make-network-policy.js'
import { makeHeadlessService } from './lib/make-service.js'
import {
  deploymentOwnerIds,
  isPublicDeployment,
} from './lib/resolve-deployment.js'
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
  const fields = [
    'id',
    'status',
    'data',
    'exposed_service',
    'exposed_port',
    'user_created.id',
    'user_updated.id',
  ]
  if (deploymentAuthorsField) {
    fields.push(`${deploymentAuthorsField}.directus_users_id.id`)
  }
  const deploymentsService = new services.ItemsService(
    COLLECTIONS.deployments,
    { schema, accountability: null }
  )
  return deploymentsService.readByQuery({ fields, limit: -1 })
}

/**
 * Declared and published service ports of a deployment item, parsed from
 * its YAML data. Unparseable data yields no port restrictions (the
 * deployment must have parsed to be deployed at all — this is a safety
 * net, and it fails open to avoid cutting off a running service).
 */
function portsOfDeployment(deployment) {
  try {
    const data = parse(deployment?.data)
    return {
      ports: declaredPorts(
        (data?.containers || []).map((c) => ({ name: c.name, ports: c.ports }))
      ),
      exposedPorts: exposedPortsOf(deployment, data),
    }
  } catch {
    return { ports: [], exposedPorts: [] }
  }
}

/**
 * Create or update the isolation resources of the given deployments:
 * the per-deployment NetworkPolicy (ingress + egress) and the headless
 * service backing cross-deployment DNS. Both are derived entirely from
 * the collection and idempotent — nothing here touches pods, so no
 * deployment is restarted.
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
    const { ports, exposedPorts } = portsOfDeployment(deployment)
    await createNetworkPolicy(
      makeNetworkPolicy(statefulSetName, {
        peerNames: peerDeploymentNames(deployments, deployment),
        ports,
        exposedPorts,
        isPublic: isPublicDeployment(deployment),
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
 * Regenerate the isolation resources of a deployment and of every
 * deployment sharing one of its owners: creating or deleting a deployment
 * changes the peers (and thus the ingress rules) of its owner group.
 *
 * @param {object} services Directus services (from the extension context)
 * @param {object} schema request schema
 * @param {object} deployment the created/updated/deleted deployment item
 */
export async function syncOwnerGroup(services, schema, deployment) {
  const deployments = await loadAllDeployments(services, schema)
  const ownerIds = new Set(deploymentOwnerIds(deployment))
  const targets = deployments.filter(
    (item) =>
      item.id === deployment.id ||
      peerSharesOwner(item, deployment, ownerIds)
  )
  return syncNetworkPolicies(services, schema, deployments, targets)
}

function peerSharesOwner(item, deployment, ownerIds) {
  return (
    item.id !== deployment.id &&
    deploymentOwnerIds(item).some((id) => ownerIds.has(id)) &&
    ownerIds.size > 0
  )
}

/**
 * Regenerate the isolation resources of the given deployment ids. Directus
 * item edits (status, owners, published port, ports in the YAML) only ever
 * affect the edited deployments' own policies: peer lists are recomputed
 * from the full collection, and cross-deployment access is decided
 * target-side — so syncing the changed items is sufficient.
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
