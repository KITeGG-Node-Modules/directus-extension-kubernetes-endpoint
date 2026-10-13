// Label key used to associate pods and other resources with a deployment.
// Set on the pod template in make-stateful-set.js and inherited by every pod.
export const APP_LABEL_KEY = 'app'

// Annotation used to force pod restarts on deployment updates
export const RESTART_ANNOTATION_KEY = 'llp.kitegg.de/restartedAt'

// Directus collections accessed by this endpoint
export const COLLECTIONS = {
  deployments: 'deployments',
  gpuReservations: 'gpu_reservations',
}

// All workload pods are scheduled onto dedicated worker nodes
export const NODE_SELECTOR = {
  'node-role.kubernetes.io/worker': 'worker',
}

// Container resource defaults and limits
export const DEFAULT_CPU = 4
export const DEFAULT_MEMORY_GI = 32

// Units assumed for numeric (unit-less) capacity values in deploy payloads:
// cpu: 8 is 8 cores, memory: 32 is 32Gi, volume size: 50 is 50Gi and
// emptyDir.sizeLimit: 128 is 128Mi. Quantity strings with an explicit unit
// ('500m', '2Gi', '512Mi') are always used as-is.
export const NUMBER_UNITS = {
  cpu: '', // whole cores
  memory: 'Gi', // gibibytes
  volumeSize: 'Gi', // gibibytes
  emptyDirSize: 'Mi', // mebibytes
}

// Maximum replicas allowed per deployment (also enforced for ?scale=)
export const MAX_REPLICAS = 16
