// Canonical mapping between GPU profile slugs (used by GPU reservations
// and the capacity endpoint) and Kubernetes extended resource names
// (used inside deployment specs). Single source of truth.
export const GPU_PROFILES = {
  'gpu-l': 'nvidia.com/gpu',
  'gpu-m': 'nvidia.com/mig-3g.40gb',
  'gpu-s': 'nvidia.com/mig-2g.20gb',
  'gpu-xs': 'nvidia.com/mig-1g.10gb',
}

export const GPU_RESOURCE_NAMES = Object.values(GPU_PROFILES)

export function gpuProfileToResource(slug) {
  return GPU_PROFILES[slug]
}

export function resourceToGpuProfile(resource) {
  return Object.keys(GPU_PROFILES).find(
    (slug) => GPU_PROFILES[slug] === resource
  )
}
