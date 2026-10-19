import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './lib/config.js'
import { upsert } from './lib/upsert.js'

/**
 * Create or update the deployment's ingress NetworkPolicy. The policy is
 * fully derived from the deployment (owners, ports, visibility), so an
 * update replaces it as-is — NetworkPolicy specs are mutable.
 */
export async function createNetworkPolicy(networkPolicy, statefulSetName) {
  const client = getKubernetesClient(
    servicesNamespace,
    k8s.NetworkingV1Api
  )
  return upsert({
    read: () =>
      client.readNamespacedNetworkPolicy(statefulSetName, servicesNamespace),
    create: () =>
      client.createNamespacedNetworkPolicy(servicesNamespace, networkPolicy),
    update: () =>
      client.replaceNamespacedNetworkPolicy(
        statefulSetName,
        servicesNamespace,
        networkPolicy
      ),
  })
}
