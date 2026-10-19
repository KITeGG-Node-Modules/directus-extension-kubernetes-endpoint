import { deploymentOwnerIds } from './resolve-deployment.js'
import { getDeploymentName } from './util.js'

/**
 * Names (StatefulSet/`app` label values) of the deployments that share at
 * least one owner (`user_created` or `authors`) with the given deployment,
 * excluding the deployment itself. These become the peer rules of the
 * deployment's ingress NetworkPolicy: only same-owner deployments may
 * reach a draft/restricted deployment.
 *
 * @param {Array} deployments all deployment items (with ownership fields)
 * @param {object} current the deployment item to compute peers for
 * @returns {string[]} e.g. ['sd-<id>', ...]
 */
export function peerDeploymentNames(deployments, current) {
  const ownerIds = new Set(deploymentOwnerIds(current))
  if (!ownerIds.size) return []
  const currentName = getDeploymentName(current.id)
  const peers = new Set()
  for (const deployment of deployments ?? []) {
    const name = getDeploymentName(deployment.id)
    if (name === currentName) continue
    const sharesOwner = deploymentOwnerIds(deployment).some((id) =>
      ownerIds.has(id)
    )
    if (sharesOwner) peers.add(name)
  }
  return [...peers]
}
