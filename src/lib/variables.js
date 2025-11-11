export const LABEL_NAMESPACE = 'llp.kitegg.de'

export const API_VERSION = 'v2'
export const ROUTE_PREFIX = `/${API_VERSION}`

export const NAMESPACE_PREFIX = 'user-'
export const UUID_LENGTH = 36
export const NAMESPACE_PREFIX_FULL_LENGTH =
  NAMESPACE_PREFIX.length + UUID_LENGTH + 1

export const GPU_PROFILE_MAPPING = {
  'gpu-l': 'nvidia.com/gpu',
  'gpu-m': 'nvidia.com/mig-3g.40gb',
  'gpu-s': 'nvidia.com/mig-2g.20gb',
  'gpu-xs': 'nvidia.com/mig-1g.10gb',
}
