import { parseQuantity } from './quantity.js'

const RESOURCE_TYPES = ['limits', 'requests']

function addContainerResources(totals, container) {
  const limits = container.resources?.limits ?? {}
  // Kubernetes defaults unspecified requests to the corresponding limits,
  // so containers that only define limits (e.g. workloads deployed by this
  // extension) count towards the requested totals, while containers that
  // only define requests count towards requests but not limits.
  const requests = { ...limits, ...container.resources?.requests }
  for (const type of RESOURCE_TYPES) {
    const values = type === 'limits' ? limits : requests
    for (const key in values) {
      const parsed = parseQuantity(values[key])
      if (parsed == null) continue
      totals[type][key] = (totals[type][key] ?? 0) + parsed
    }
  }
}

/**
 * Sum pod resources per node the way the scheduler accounts them:
 * per resource, a pod's usage is the larger of the sum of its main
 * containers and the heaviest single init container (they never run
 * concurrently). Pods that terminated no longer reserve resources.
 *
 * Values are base units: cores for cpu, bytes for memory.
 */
export function sumPodResources(pods) {
  const totals = { limits: {}, requests: {} }
  for (const pod of pods) {
    if (pod.status?.phase === 'Succeeded' || pod.status?.phase === 'Failed') {
      continue
    }
    const main = { limits: {}, requests: {} }
    const init = { limits: {}, requests: {} }
    for (const container of pod.spec?.containers ?? []) {
      addContainerResources(main, container)
    }
    for (const container of pod.spec?.initContainers ?? []) {
      addContainerResources(init, container)
    }
    for (const type of RESOURCE_TYPES) {
      const keys = new Set([
        ...Object.keys(main[type]),
        ...Object.keys(init[type]),
      ])
      for (const key of keys) {
        totals[type][key] =
          (totals[type][key] ?? 0) +
          Math.max(main[type][key] ?? 0, init[type][key] ?? 0)
      }
    }
  }
  return totals
}
