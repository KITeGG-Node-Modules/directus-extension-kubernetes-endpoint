import { getWorkers } from './get-workers.js'

export async function getClusterCapacity() {
  const workers = await getWorkers()
  const results = []
  for (const worker of workers) {
    const result = { name: worker.name }
    result.available = {}
    for (const key in worker.allocatable) {
      if (key.startsWith('nvidia')) {
        result.available[key] = worker.allocatable[key]
      }
    }
    result.requested = {}
    for (const key in worker.resources.limits) {
      if (key.startsWith('nvidia')) {
        result.requested[key] = worker.resources.limits[key]
      }
    }
    results.push(result)
  }
  return results
}
