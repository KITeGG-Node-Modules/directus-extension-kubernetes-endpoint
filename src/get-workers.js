import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import { sumPodResources } from './lib/node-resources.js'

export async function getWorkers() {
  const client = getKubernetesClient()
  const response = await client.listNode()
  const podResponse = await client.listPodForAllNamespaces()
  const pods = podResponse.body.items
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
