import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import { countedNamespaces } from './lib/config.js'
import { sumPodResources } from './lib/node-resources.js'

export async function getWorkers() {
  const client = getKubernetesClient()
  const response = await client.listNode()
  const podResponse = await client.listPodForAllNamespaces()
  // Only count workloads whose GPU consumption is governed by the
  // gpu_reservations system: user services and JupyterHub user notebooks
  // (GPU profiles there are unlocked by reservations and enforced by the
  // reservations-watcher). System pods (Traefik, oauth2-proxy, monitoring
  // agents, ...) sharing the worker nodes stay out of the utilisation
  // display.
  const pods = podResponse.body.items.filter((pod) =>
    countedNamespaces.includes(pod.metadata?.namespace)
  )
  const workers = response.body.items
    .filter(
      (node) =>
        node.metadata.labels?.['node-role.kubernetes.io/worker'] === 'worker'
    )
    .map((node) => ({
      name: node.metadata.name,
      labels: node.metadata.labels,
      addresses: node.status.addresses,
      allocatable: node.status.allocatable,
      capacity: node.status.capacity,
      nodeInfo: node.status.nodeInfo,
    }))
  for (const worker of workers) {
    worker.pods = pods.filter((pod) => pod.spec.nodeName === worker.name)
    // Overhead? https://github.com/kubernetes/kubectl/blob/master/pkg/util/resource/resource.go#L46
    worker.resources = sumPodResources(worker.pods)
  }
  return workers
}
