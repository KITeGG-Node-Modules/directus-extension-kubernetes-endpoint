import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './config.js'
import {
  APP_LABEL_KEY,
  INGRESS_CONTROLLER_EGRESS_PORTS,
  INGRESS_EXTRA_NAMESPACES,
  INGRESS_NAMESPACE,
  INGRESS_PROXY_POD_LABELS,
  INGRESS_SYSTEM_POD_LABELS,
  PUBLIC_INGRESS_IPS,
  SYSTEM_APP_LABEL_VALUES,
} from './constants.js'

// Egress exclusions for the "internet" rule: every range that must stay
// unreachable from user workloads (verified against the live cluster —
// see the jupyterhub repo):
//   - 192.168.0.0/16   -> pod CIDR: all pods, all namespaces; also covers
//                          the RFC1918 192.168/16 private range
//   - 10.96.0.0/12     -> service CIDR: all ClusterIPs, incl. the
//                          `kubernetes` API service (10.96.0.1)
//   - 10.10.10.0/24    -> node network (control plane advertise addresses
//                          10.10.10.1/.3, kubelets)
//   - RFC1918          -> any other private ranges routed from the nodes
//   - 169.254.0.0/16   -> link-local, notably the cloud metadata service
//                          169.254.169.254 (SSRF target)
//   - 100.64.0.0/10    -> shared address space (encap IPs on some CNIs)
//   - 134.93.175.62/32, .63/32 -> PUBLIC control-plane addresses
//                          (hsm-kitegg-a/b.zdv.uni-mainz.de); without
//                          these the pods could reach the Kubernetes API
//                          over the internet. The same addresses front
//                          the Traefik ingress LoadBalancer — the web
//                          ports are re-opened by a dedicated egress rule
//                          below; everything else (notably 6443) stays
//                          blocked.
const INTERNET_EXCEPT = [
  '192.168.0.0/16',
  '10.96.0.0/12',
  '10.10.10.0/24',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '134.93.175.62/32',
  '134.93.175.63/32',
]

/**
 * Per-deployment NetworkPolicy, created and updated with every deploy and
 * by the backfill endpoint for existing deployments. Selected by the
 * deployment's `app` label — the one label present on every pod, existing
 * ones included — so applying it never requires a pod template change and
 * therefore never restarts anything.
 *
 * NetworkPolicies are purely additive, so this policy can only ever open
 * the deployment's own pods.
 *
 * Ingress:
 * - replicas of the deployment itself (any port),
 * - the ingress path (Traefik directly, and oauth2-proxy for
 *   *.service.kitegg.hs-mainz.de), on the declared service ports only,
 * - the extra ingress namespaces (JupyterHub), the Open WebUI instances
 *   and other user deployments — also on the declared ports only.
 *
 * The deployment's Directus `status` (e.g. `draft`) does not participate
 * in the policy: it only controls visibility in the services overview.
 *
 * Egress:
 * - DNS (CoreDNS in kube-system),
 * - other user deployments' pods (their own ingress policies decide who
 *   may connect — this only provides the path; cross-deployment clients
 *   use the headless service `sd-<id>.services.svc.cluster.local`, whose
 *   DNS resolves to the pod IPs),
 * - the public internet,
 * - the Traefik entry point on the cluster's public addresses
 *   (hsm-kitegg-a/b.zdv.uni-mainz.de) and the Traefik pods themselves
 *   (traefik-v2 namespace) on their entrypoint ports — these addresses
 *   and pods also front the ingress; the Kubernetes API stays blocked
 *   because the internet rule excepts the public addresses entirely and
 *   no other cluster-internal destination is allowed.
 *
 * Everything else is denied: system-internal services in the namespace,
 * pods and services of any other namespace, node networks and the
 * Kubernetes API.
 */
export function makeNetworkPolicy(statefulSetName, { ports = [] } = {}) {
  const metadata = new k8s.V1ObjectMeta()
  metadata.name = statefulSetName
  metadata.namespace = servicesNamespace
  metadata.labels = { [APP_LABEL_KEY]: statefulSetName }

  const spec = new k8s.V1NetworkPolicySpec()
  spec.podSelector = new k8s.V1LabelSelector()
  spec.podSelector.matchLabels = { [APP_LABEL_KEY]: statefulSetName }
  spec.policyTypes = ['Ingress', 'Egress']

  const ingress = []

  // Replicas of this deployment may talk to each other on any port
  ingress.push(
    makeIngressRule([podPeer({ [APP_LABEL_KEY]: statefulSetName })], null)
  )

  // The ingress path (Traefik and oauth2-proxy), on the declared ports
  ingress.push(makeIngressRule(ingressPathPeers(), ports))

  // The extra ingress namespaces (JupyterHub), the Open WebUI instances
  // and other user deployments, on the declared ports only
  const extraNamespacePeers = INGRESS_EXTRA_NAMESPACES.map((namespace) => {
    const peer = new k8s.V1NetworkPolicyPeer()
    peer.namespaceSelector = new k8s.V1LabelSelector()
    peer.namespaceSelector.matchLabels = {
      'kubernetes.io/metadata.name': namespace,
    }
    return peer
  })
  ingress.push(
    makeIngressRule(
      [
        ...extraNamespacePeers,
        ...INGRESS_SYSTEM_POD_LABELS.map((labels) => podPeer(labels)),
        anyUserPodPeer(),
      ],
      ports
    )
  )
  spec.ingress = ingress

  const egress = []

  // DNS: CoreDNS in kube-system (kubeadm default)
  const dnsPeer = new k8s.V1NetworkPolicyPeer()
  dnsPeer.namespaceSelector = new k8s.V1LabelSelector()
  dnsPeer.namespaceSelector.matchLabels = {
    'kubernetes.io/metadata.name': 'kube-system',
  }
  dnsPeer.podSelector = new k8s.V1LabelSelector()
  dnsPeer.podSelector.matchLabels = { 'k8s-app': 'kube-dns' }
  const dnsRule = new k8s.V1NetworkPolicyEgressRule()
  dnsRule.to = [dnsPeer]
  dnsRule.ports = ['UDP', 'TCP'].map((protocol) => {
    const port = new k8s.V1NetworkPolicyPort()
    port.protocol = protocol
    port.port = 53
    return port
  })
  egress.push(dnsRule)

  // Other user deployments' pods (system-internal services excluded —
  // their own ingress policies decide who may connect)
  const userPodsRule = new k8s.V1NetworkPolicyEgressRule()
  userPodsRule.to = [new k8s.V1NetworkPolicyPeer()]
  userPodsRule.to[0].podSelector = new k8s.V1LabelSelector()
  userPodsRule.to[0].podSelector.matchExpressions = [
    { key: APP_LABEL_KEY, operator: 'Exists' },
    {
      key: APP_LABEL_KEY,
      operator: 'NotIn',
      values: SYSTEM_APP_LABEL_VALUES,
    },
  ]
  egress.push(userPodsRule)

  // The Traefik entry point on the public control-plane addresses. The
  // internet rule below keeps excepting these addresses entirely, so every
  // other port — notably the Kubernetes API on 6443 — remains unreachable.
  // For .63 this rule is mostly a no-op in practice: kube-proxy DNATs
  // packets to the ingress IP into the Traefik pod before Calico evaluates
  // this policy, so the namespace rule below is what carries that traffic
  // (see PUBLIC_INGRESS_IPS in constants.js).
  const publicIngressRule = new k8s.V1NetworkPolicyEgressRule()
  publicIngressRule.to = PUBLIC_INGRESS_IPS.map((ip) => {
    const peer = new k8s.V1NetworkPolicyPeer()
    const block = new k8s.V1IPBlock()
    block.cidr = `${ip}/32`
    peer.ipBlock = block
    return peer
  })
  publicIngressRule.ports = ['TCP'].flatMap((protocol) =>
    [80, 443].map((port) => {
      const policyPort = new k8s.V1NetworkPolicyPort()
      policyPort.protocol = protocol
      policyPort.port = port
      return policyPort
    })
  )
  egress.push(publicIngressRule)

  // The Traefik pods themselves: kube-proxy DNATs connections to the
  // public ingress IP into the Traefik pod (traefik-v2 namespace) BEFORE
  // Calico evaluates egress policy, so the destination seen here is the
  // Traefik pod IP on its pod ports (8000/8443) — cluster-internal, hence
  // otherwise dropped by the internet rule's pod-CIDR exception. This rule
  // re-opens exactly that path, port-restricted to Traefik's entrypoints.
  // New connections from Traefik to user pods are already covered by the
  // ingress rules; replies to this direction are ESTABLISHED and bypass
  // the ingress default-deny.
  const traefikRule = new k8s.V1NetworkPolicyEgressRule()
  const traefikPeer = new k8s.V1NetworkPolicyPeer()
  traefikPeer.namespaceSelector = new k8s.V1LabelSelector()
  traefikPeer.namespaceSelector.matchLabels = {
    'kubernetes.io/metadata.name': INGRESS_NAMESPACE,
  }
  traefikRule.to = [traefikPeer]
  traefikRule.ports = INGRESS_CONTROLLER_EGRESS_PORTS.map((port) => {
    const policyPort = new k8s.V1NetworkPolicyPort()
    policyPort.protocol = 'TCP'
    policyPort.port = port
    return policyPort
  })
  egress.push(traefikRule)

  // The public internet (cluster-internal ranges excluded, see above)
  const internetRule = new k8s.V1NetworkPolicyEgressRule()
  const internetBlock = new k8s.V1IPBlock()
  internetBlock.cidr = '0.0.0.0/0'
  internetBlock.except = INTERNET_EXCEPT
  internetRule.to = [new k8s.V1NetworkPolicyPeer()]
  internetRule.to[0].ipBlock = internetBlock
  egress.push(internetRule)

  spec.egress = egress

  const policy = new k8s.V1NetworkPolicy()
  policy.metadata = metadata
  policy.spec = spec
  return policy
}

/**
 * Selector matching any user-workload pod in the namespace: pods with an
 * `app` label that is not one of the system-internal services.
 */
function anyUserPodPeer() {
  const peer = new k8s.V1NetworkPolicyPeer()
  peer.podSelector = new k8s.V1LabelSelector()
  peer.podSelector.matchExpressions = [
    { key: APP_LABEL_KEY, operator: 'Exists' },
    {
      key: APP_LABEL_KEY,
      operator: 'NotIn',
      values: SYSTEM_APP_LABEL_VALUES,
    },
  ]
  return peer
}

function podPeer(matchLabels) {
  const peer = new k8s.V1NetworkPolicyPeer()
  peer.podSelector = new k8s.V1LabelSelector()
  peer.podSelector.matchLabels = matchLabels
  return peer
}

// The ingress path: Traefik (for the direct routes) and the oauth2-proxy
// `service-proxy` pods (fronting *.service.kitegg.hs-mainz.de; the NGINX
// TLS proxy on NodePort :30443 forwards into these, needing no rule of
// its own)
function ingressPathPeers() {
  const traefikPeer = new k8s.V1NetworkPolicyPeer()
  traefikPeer.namespaceSelector = new k8s.V1LabelSelector()
  traefikPeer.namespaceSelector.matchLabels = {
    'kubernetes.io/metadata.name': INGRESS_NAMESPACE,
  }
  return [traefikPeer, podPeer(INGRESS_PROXY_POD_LABELS)]
}

function makeIngressRule(peers, ports) {
  const rule = new k8s.V1NetworkPolicyIngressRule()
  rule.from = peers
  if (ports?.length) {
    rule.ports = ports.map((p) => {
      const policyPort = new k8s.V1NetworkPolicyPort()
      policyPort.port = p.port
      return policyPort
    })
  }
  return rule
}

/**
 * The ports other deployments and the ingress path may reach: every port
 * the deployment itself declares for its containers (deduplicated by name
 * and number). Ports not declared here — admin interfaces, debug ports —
 * stay unreachable from outside the deployment.
 */
export function declaredPorts(servicePayloads) {
  const seen = new Set()
  const ports = []
  for (const payload of servicePayloads ?? []) {
    for (const port of payload?.ports ?? []) {
      const key = `${port.name}:${port.port}`
      if (seen.has(key)) continue
      seen.add(key)
      ports.push({ name: port.name, port: port.port })
    }
  }
  return ports
}
