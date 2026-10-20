// Label key used to associate pods and other resources with a deployment.
// Set on the pod template in make-stateful-set.js and inherited by every pod.
export const APP_LABEL_KEY = 'app'

// Annotation used to force pod restarts on deployment updates
export const RESTART_ANNOTATION_KEY = 'llp.kitegg.de/restartedAt'

// Ingress sources allowed to reach deployments, matching the sources
// documented in k8s/network-policy.yaml:
// - the Traefik ingress controller namespace (direct IngressRoutes), and
// - the oauth2-proxy pods fronting *.service.kitegg.hs-mainz.de, running
//   in the services namespace itself (verified pod label: app: service-proxy)
export const INGRESS_NAMESPACE = 'traefik-v2'
export const INGRESS_PROXY_POD_LABELS = { app: 'service-proxy' }

// Additional namespaces whose pods may reach deployments on their
// declared service ports — the JupyterHub hub and user notebooks connect
// to published user services directly.
export const INGRESS_EXTRA_NAMESPACES = ['jupyterhub']

// System-internal pods allowed to reach deployments on their declared
// service ports: the Open WebUI instances connect to published user
// services (e.g. LLM gateways) directly.
export const INGRESS_SYSTEM_POD_LABELS = [
  { app: 'openwebui' },
  { app: 'openwebui-ccl' },
]

// Public addresses of the control-plane endpoint (hsm-kitegg-a/b.zdv.
// uni-mainz.de). They host BOTH the Kubernetes API (6443) and the Traefik
// ingress LoadBalancer (80/443). Egress to them is allowed on the web
// ports only — the Kubernetes API stays unreachable (the internet egress
// rule excepts these addresses entirely, see make-network-policy.js).
//
// NOTE on .63 (this cluster's ingress IP): kube-proxy DNATs packets to the
// Traefik LoadBalancer IP into the Traefik POD (192.168.23.x) BEFORE Calico
// evaluates the egress policy, so the /32 rule below never matches for
// .63 — the dedicated traefik-v2 namespace rule (see
// INGRESS_CONTROLLER_EGRESS_PORTS) is what actually carries this traffic.
// The /32 rule stays for .62 (the other cluster's ingress, no local DNAT)
// and as a fallback.
export const PUBLIC_INGRESS_IPS = ['134.93.175.62', '134.93.175.63']

// Traefik's POD ports (targetPort of the traefik-v2 Service: web -> 8000,
// websecure -> 8443). Egress policy is evaluated AFTER kube-proxy's DNAT,
// so pods connecting to the public ingress IP arrive at Calico with these
// ports as the destination — the public ports (80/443) are already gone.
// Verified against the live traefik-v2/traefik Service.
export const INGRESS_CONTROLLER_EGRESS_PORTS = [8000, 8443]

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

// Registries user containers may pull images from by default (env:
// IMAGE_REGISTRY_ALLOWLIST). nvcr.io for NVIDIA GPU container images;
// mcr.microsoft.com for Microsoft's; a bare image name ('pytorch/pytorch')
// implies docker.io.
export const DEFAULT_IMAGE_REGISTRIES = [
  'docker.io',
  'ghcr.io',
  'quay.io',
  'nvcr.io',
  'mcr.microsoft.com',
  'registry.kitegg.de',
  'registry.motionbank.org',
]

// Capabilities a user container may be granted beyond the default drop
// of ALL. This is exactly the Docker/containerd default capability set,
// so images that ran on plain Docker keep working — everything beyond
// (SYS_ADMIN, ...) was never available by default either. make-container
// always drops ALL and adds back only these, and only when the user
// requests them via the container's `capabilities` field.
export const ALLOWED_CAPABILITIES = [
  'AUDIT_WRITE',
  'CHOWN',
  'DAC_OVERRIDE',
  'FOWNER',
  'FSETID',
  'KILL',
  'MKNOD',
  'NET_BIND_SERVICE',
  'NET_RAW',
  'SETFCAP',
  'SETGID',
  'SETPCAP',
  'SETUID',
  'SYS_CHROOT',
]
