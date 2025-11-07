import { baseRequestHandler } from 'kitegg-directus-extension-common'
import { ROUTE_PREFIX } from '../../lib/config.js'

export function mapResourceNames(resourceName) {
  switch (resourceName) {
    case 'nvidia.com/gpu':
      return 'gpu-l'
    case 'nvidia.com/mig-1g.10gb':
      return 'gpu-xs'
    case 'nvidia.com/mig-2g.20gb':
      return 'gpu-s'
    case 'nvidia.com/mig-3g.40gb':
      return 'gpu-m'
    default:
      return resourceName
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
      if (container.resources.limits && container.resources.requests) {
        for (const type in worker.resources) {
          for (const key in container.resources[type]) {
            let value = parseFloat(container.resources[type][key])
            if (worker.resources[type][key])
              worker.resources[type][key] += value
            else worker.resources[type][key] = value
          }
        }
      }
    }
  }
  return workers
}

export function getCapacity(router, context) {
  router.get(
    `${ROUTE_PREFIX}/capacity`,
    baseRequestHandler(async () => {
      const workers = await getWorkers()
      const results = []
      for (const worker of workers) {
        const result = { name: worker.name }
        result.available = {}
        for (const key in worker.allocatable) {
          if (key.startsWith('nvidia')) {
            result.available[mapResourceNames(key)] = worker.allocatable[key]
          }
        }
        result.requested = {}
        for (const key in worker.resources.limits) {
          if (key.startsWith('nvidia')) {
            result.requested[mapResourceNames(key)] =
              worker.resources.limits[key]
          }
        }
        results.push(result)
      }
      return results
    }, context)
  )
}
