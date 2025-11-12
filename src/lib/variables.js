export const LABEL_NAMESPACE = 'llp.kitegg.de'
export const API_VERSION = 'v2'
export const NAMESPACE_PREFIX = 'user-'

export const ROUTE_PREFIX = `/${API_VERSION}`
export const UUID_LENGTH = 36
export const NAMESPACE_PREFIX_FULL_LENGTH =
  NAMESPACE_PREFIX.length + UUID_LENGTH + 1

export const GPU_NVIDIA_FULL = 'nvidia.com/gpu'
export const GPU_NVIDIA_MIG_1G_10 = 'nvidia.com/mig-1g.10gb'
export const GPU_NVIDIA_MIG_2G_20 = 'nvidia.com/mig-2g.20gb'
export const GPU_NVIDIA_MIG_3G_40 = 'nvidia.com/mig-3g.40gb'

export const GPU_PROFILES = [
  GPU_NVIDIA_FULL,
  GPU_NVIDIA_MIG_1G_10,
  GPU_NVIDIA_MIG_2G_20,
  GPU_NVIDIA_MIG_3G_40,
]
export const GPU_PROFILE_MAPPING = {
  'gpu-l': GPU_NVIDIA_FULL,
  'gpu-m': GPU_NVIDIA_MIG_3G_40,
  'gpu-s': GPU_NVIDIA_MIG_2G_20,
  'gpu-xs': GPU_NVIDIA_MIG_1G_10,
}
