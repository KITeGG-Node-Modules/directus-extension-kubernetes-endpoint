// Label key used to associate pods and other resources with a deployment.
// Set on the pod template in make-stateful-set.js and inherited by every pod.
export const APP_LABEL_KEY = 'app'

// Annotation used to force pod restarts on deployment updates
export const RESTART_ANNOTATION_KEY = 'llp.kitegg.de/restartedAt'

// Shared label marking every pod created by this extension as a user
// workload. The static hardening policies in k8s/network-policy.yaml
// select all user workloads by this label. NOT required for enforcement:
// the per-deployment policies (make-network-policy.js) select pods by the
// universal `app` label, so existing deployments are isolated without any
// pod template change (which would trigger a rolling restart).
export const WORKLOAD_LABEL_KEY = 'llp.kitegg.de/workload'
export const WORKLOAD_LABEL_VALUE = 'true'

// Ingress sources allowed to reach PUBLIC deployments, matching the
// sources documented in k8s/network-policy.yaml:
// - the Traefik ingress controller namespace (direct IngressRoutes), and
// - the oauth2-proxy pods fronting *.service.kitegg.hs-mainz.de, running
//   in the services namespace itself (verified pod label: app: service-proxy)
export const INGRESS_NAMESPACE = 'traefik-v2'
export const INGRESS_PROXY_POD_LABELS = { app: 'service-proxy' }

// Additional namespaces whose pods may reach PUBLIC deployments on their
// declared service ports — the JupyterHub hub and user notebooks connect
// to published user services directly. Draft/restricted deployments stay
// unreachable from these namespaces.
export const INGRESS_EXTRA_NAMESPACES = ['jupyterhub']

// `app` label values of the system-internal services sharing the services
// namespace. Used to exclude them from the "any user pod" selectors (as an
// ingress source and as an egress destination) — user workloads must not
// reach them. MAINTENANCE: when a new system-internal service is added to
// the namespace, add its app label value here and re-run the backfill
// endpoint so the per-deployment policies are regenerated.
export const SYSTEM_APP_LABEL_VALUES = [
  'cache',
  'nginx',
  'openwebui',
  'openwebui-ccl',
  'service-proxy',
  'tty-server',
]

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
