import { describe, expect, it } from 'vitest'
import {
  declaredPorts,
  makeNetworkPolicy,
} from '../src/lib/make-network-policy.js'
import { makeHeadlessService, makeService } from '../src/lib/make-service.js'

const ports = [{ name: 'http', port: 80 }, { port: 8080 }]

function ingressSources(rule) {
  return (rule.from ?? []).map(
    (peer) => peer.podSelector?.matchLabels ?? peer.podSelector ?? null
  )
}

describe('makeNetworkPolicy', () => {

  it('allows itself, the ingress path and other user workloads', () => {
    const policy = makeNetworkPolicy('sd-5', { ports })
    expect(policy.metadata).toMatchObject({
      name: 'sd-5',
      namespace: 'services',
      labels: { app: 'sd-5' },
    })
    expect(policy.spec.policyTypes).toEqual(['Ingress', 'Egress'])
    expect(policy.spec.podSelector.matchLabels).toEqual({ app: 'sd-5' })

    // Self rule without port restrictions
    const [selfRule, pathRule, publicRule] = policy.spec.ingress
    expect(ingressSources(selfRule)).toEqual([{ app: 'sd-5' }])
    expect(selfRule.ports).toBeUndefined()

    // The ingress path (Traefik + oauth2-proxy) on the declared ports
    const [traefikPeer, proxyPeer] = pathRule.from
    expect(traefikPeer.namespaceSelector.matchLabels).toEqual({
      'kubernetes.io/metadata.name': 'traefik-v2',
    })
    expect(traefikPeer.podSelector).toBeUndefined()
    expect(proxyPeer.podSelector.matchLabels).toEqual({ app: 'service-proxy' })
    expect(pathRule.ports.map((port) => port.port)).toEqual([80, 8080])

    // Extra ingress namespaces, Open WebUI instances and user pods
    const [jupyterhubPeer, openwebuiPeer, openwebuiCclPeer, userPodsPeer] =
      publicRule.from
    expect(jupyterhubPeer.namespaceSelector.matchLabels).toEqual({
      'kubernetes.io/metadata.name': 'jupyterhub',
    })
    expect(jupyterhubPeer.podSelector).toBeUndefined()
    expect(openwebuiPeer.podSelector.matchLabels).toEqual({ app: 'openwebui' })
    expect(openwebuiCclPeer.podSelector.matchLabels).toEqual({
      app: 'openwebui-ccl',
    })
    expect(userPodsPeer.podSelector.matchExpressions).toEqual([
      { key: 'app', operator: 'Exists' },
      {
        key: 'app',
        operator: 'NotIn',
        values: [
          'cache',
          'nginx',
          'openwebui',
          'openwebui-ccl',
          'service-proxy',
          'tty-server',
        ],
      },
    ])
    expect(publicRule.ports.map((port) => port.port)).toEqual([80, 8080])
  })

  it('is independent of the deployment status (drafts are unrestricted)', () => {
    // The policy input carries no visibility information at all: every
    // deployment gets the same ingress rules
    const policy = makeNetworkPolicy('sd-5', { ports })
    expect(policy.spec.ingress).toHaveLength(3)
  })

  it('builds egress for DNS, user pods, the public ingress and the internet', () => {
    const policy = makeNetworkPolicy('sd-5', { ports })
    const [dnsRule, userPodsRule, publicIngressRule, internetRule] =
      policy.spec.egress

    expect(dnsRule.to[0]).toMatchObject({
      namespaceSelector: {
        matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' },
      },
      podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
    })
    expect(dnsRule.ports.map((port) => port.port)).toEqual([53, 53])

    expect(userPodsRule.to[0].podSelector.matchExpressions).toEqual([
      { key: 'app', operator: 'Exists' },
      { key: 'app', operator: 'NotIn', values: expect.any(Array) },
    ])

    // The Traefik entry point on the public control-plane addresses: web
    // ports only, so the Kubernetes API (6443) stays unreachable
    expect(
      publicIngressRule.to.map((peer) => peer.ipBlock.cidr)
    ).toEqual(['134.93.175.62/32', '134.93.175.63/32'])
    expect(
      publicIngressRule.ports.map((port) => [port.protocol, port.port])
    ).toEqual([
      ['TCP', 80],
      ['TCP', 443],
    ])

    expect(internetRule.to[0].ipBlock.cidr).toBe('0.0.0.0/0')
    for (const internal of ['192.168.0.0/16', '10.96.0.0/12', '169.254.169.254/32']) {
      // 169.254.169.254 is covered by the link-local except
      if (internal === '169.254.169.254/32') {
        expect(internetRule.to[0].ipBlock.except).toContain('169.254.0.0/16')
      } else {
        expect(internetRule.to[0].ipBlock.except).toContain(internal)
      }
    }
    expect(internetRule.to[0].ipBlock.except).toContain('134.93.175.62/32')
    expect(internetRule.to[0].ipBlock.except).toContain('134.93.175.63/32')
  })

  it('allows all ports when the deployment declares none', () => {
    const policy = makeNetworkPolicy('sd-5', {})
    const [, ...withoutSelf] = policy.spec.ingress
    for (const rule of withoutSelf) {
      expect(rule.ports).toBeUndefined()
    }
  })
})

describe('declaredPorts', () => {
  it('flattens and deduplicates the declared service ports', () => {
    expect(
      declaredPorts([
        {
          name: 'app',
          ports: [{ name: 'http', port: 80 }, { name: 'admin', port: 9000 }],
        },
        { name: 'sidecar', ports: [{ name: 'http', port: 80 }] },
      ])
    ).toEqual([
      { name: 'http', port: 80 },
      { name: 'admin', port: 9000 },
    ])
    expect(declaredPorts([])).toEqual([])
  })
})

describe('makeHeadlessService', () => {
  it('creates a portless cluster-IP-none service selecting the pods', () => {
    const service = makeHeadlessService('sd-5')
    expect(service.metadata).toMatchObject({
      name: 'sd-5',
      namespace: 'services',
      labels: { app: 'sd-5' },
    })
    expect(service.spec.clusterIP).toBe('None')
    expect(service.spec.selector).toEqual({ app: 'sd-5' })
    expect(service.spec.ports).toBeUndefined()
  })

  it('keeps regular services ClusterIP-backed with their ports', () => {
    const service = makeService('sd-5', 'sd-5-app', [{ name: 'http', port: 80 }])
    expect(service.spec.clusterIP).toBeUndefined()
    expect(service.spec.ports).toEqual([
      expect.objectContaining({ name: 'http', port: 80 }),
    ])
  })
})
