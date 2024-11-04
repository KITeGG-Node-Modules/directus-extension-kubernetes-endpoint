import { getWorkers } from './get-workers.js'

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

export async function getClusterCapacity() {
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
        result.requested[mapResourceNames(key)] = worker.resources.limits[key]
      }
    }
    results.push(result)
  }
  return results
}
