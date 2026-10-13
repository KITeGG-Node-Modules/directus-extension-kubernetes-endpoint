import { getKubernetesClient } from 'kitegg-directus-extension-common'

function aggregate(target, source) {
  for (const key in source) {
    const value = parseFloat(source[key])
    if (key in target) target[key] += value
    else target[key] = value
  }
}

export async function getWorkers() {
  const client = getKubernetesClient()
  const response = await client.listNode()
  const podResponse = await client.listPodForAllNamespaces()
  const pods = podResponse.body.items
  const workers = response.body.items
    .filter(
      (node) =>
        node.metadata.labels['node-role.kubernetes.io/worker'] === 'worker'
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
    // Overhead? https://github.com/kubernetes/kubectl/blob/master/pkg/util/resource/resource.go#L46
    worker.pods = pods.filter((pod) => pod.spec.nodeName === worker.name)
    const containers = worker.pods.map((pod) => pod.spec.containers).flat()
    worker.resources = {
      limits: {},
      requests: {},
    }
    for (const container of containers) {
      const { limits = {}, requests = {} } = container.resources || {}
      // Kubernetes defaults unspecified requests to the corresponding
      // limits, so containers that only define limits (e.g. the GPU
      // workloads deployed by this extension) count towards the requested
      // totals. Conversely, containers that only define requests (the
      // common case for workloads not deployed by this extension) count
      // towards the requested, but not the limits, totals.
      aggregate(worker.resources.requests, { ...limits, ...requests })
      aggregate(worker.resources.limits, limits)
    }
  }
  return workers
}
