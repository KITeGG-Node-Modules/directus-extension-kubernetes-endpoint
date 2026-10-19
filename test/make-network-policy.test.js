import { describe, expect, it } from 'vitest'
import {
  declaredPorts,
  exposedPortsOf,
  makeNetworkPolicy,
} from '../src/lib/make-network-policy.js'
import { peerDeploymentNames } from '../src/lib/deployment-peers.js'
import { makeHeadlessService, makeService } from '../src/lib/make-service.js'

const USER = '9f8b1c3e-2a4d-4c6b-8e0f-1a2b3c4d5e6f'
const COLLEAGUE = '42'

const deployments = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    user_created: { id: USER },
    authors: [{ directus_users_id: { id: COLLEAGUE } }],
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    user_created: { id: USER },
    authors: [],
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    user_created: { id: COLLEAGUE },
    authors: [],
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    user_created: { id: 'other-user' },
    authors: [],
  },
]

const ports = [{ name: 'http', port: 80 }, { port: 8080 }]

function ingressSources(rule) {
  return (rule.from ?? []).map(
    (peer) => peer.podSelector?.matchLabels ?? peer.podSelector ?? null
  )
}

describe('peerDeploymentNames', () => {
  it('returns deployments sharing an owner, excluding the deployment itself', () => {
    const current = deployments[0]
    expect(peerDeploymentNames(deployments, current)).toEqual([
      'sd-22222222-2222-2222-2222-222222222222',
      'sd-33333333-3333-3333-3333-333333333333',
    ])
  })

  it('returns nothing for deployments without owners', () => {
    expect(peerDeploymentNames(deployments, { id: '5' })).toEqual([])
  })
})

describe('makeNetworkPolicy', () => {
  const peers = ['sd-22222222-2222-2222-2222-222222222222']

  it('allows itself and same-owner deployments only when restricted', () => {
    const policy = makeNetworkPolicy('sd-5', {
      peerNames: peers,
      ports,
    })
    expect(policy.metadata).toMatchObject({
      name: 'sd-5',
      namespace: 'services',
      labels: { app: 'sd-5' },
    })
    expect(policy.spec.policyTypes).toEqual(['Ingress', 'Egress'])
    expect(policy.spec.podSelector.matchLabels).toEqual({ app: 'sd-5' })

    // Self rule without port restrictions
    const [selfRule, ...peerRules] = policy.spec.ingress
    expect(ingressSources(selfRule)).toEqual([{ app: 'sd-5' }])
    expect(selfRule.ports).toBeUndefined()

    // One rule per same-owner deployment, restricted to the declared ports
    expect(peerRules).toHaveLength(peers.length)
    for (const [index, rule] of peerRules.entries()) {
      expect(ingressSources(rule)).toEqual([{ app: peers[index] }])
      expect(rule.ports.map((port) => port.port)).toEqual([80, 8080])
    }
  })

  it('adds the ingress path and other user deployments for public deployments', () => {
    const policy = makeNetworkPolicy('sd-5', {
      peerNames: peers,
      ports,
      isPublic: true,
    })
    // Separate rules: ingress path, then extra namespaces + user pods
    const pathRule = policy.spec.ingress.at(-2)
    const publicRule = policy.spec.ingress.at(-1)
    const [traefikPeer, proxyPeer] = pathRule.from
    expect(traefikPeer.namespaceSelector.matchLabels).toEqual({
      'kubernetes.io/metadata.name': 'traefik-v2',
    })
    expect(traefikPeer.podSelector).toBeUndefined()
    expect(proxyPeer.podSelector.matchLabels).toEqual({ app: 'service-proxy' })
    expect(pathRule.ports.map((port) => port.port)).toEqual([80, 8080])

    const [jupyterhubPeer, userPodsPeer] = publicRule.from
    expect(jupyterhubPeer.namespaceSelector.matchLabels).toEqual({
      'kubernetes.io/metadata.name': 'jupyterhub',
    })
    expect(jupyterhubPeer.podSelector).toBeUndefined()
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

  it('builds egress for DNS, user pods and the internet only', () => {
    const policy = makeNetworkPolicy('sd-5', { peerNames: peers, ports })
    const [dnsRule, userPodsRule, internetRule] = policy.spec.egress

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
    const policy = makeNetworkPolicy('sd-5', {
      peerNames: peers,
      isPublic: true,
    })
    const [, ...withoutSelf] = policy.spec.ingress
    for (const rule of withoutSelf) {
      expect(rule.ports).toBeUndefined()
    }
  })
})

describe('exposedPortsOf', () => {
  const data = {
    containers: [
      { name: 'app', ports: [{ name: 'http', port: 80 }, { name: 'admin', port: 9000 }] },
      { name: 'sidecar', ports: [{ name: 'metrics', port: 9090 }] },
    ],
  }

  it('resolves the published port of the exposed container by name', () => {
    expect(
      exposedPortsOf({ exposed_service: 'app', exposed_port: 'http' }, data)
    ).toEqual([{ name: 'http', port: 80 }])
  })

  it('resolves by port number', () => {
    expect(
      exposedPortsOf({ exposed_service: 'app', exposed_port: 9000 }, data)
    ).toEqual([{ name: 'admin', port: 9000 }])
    // Also accepts a number as string
    expect(
      exposedPortsOf({ exposed_service: 'app', exposed_port: '9000' }, data)
    ).toEqual([{ name: 'admin', port: 9000 }])
  })

  it('falls back to all ports of the exposed container when no port is given', () => {
    expect(exposedPortsOf({ exposed_service: 'app' }, data)).toEqual([
      { name: 'http', port: 80 },
      { name: 'admin', port: 9000 },
    ])
  })

  it('falls back to all containers when no service is given', () => {
    expect(
      exposedPortsOf({ exposed_port: 'metrics' }, data)
    ).toEqual([{ name: 'metrics', port: 9090 }])
  })

  it('publishes nothing for unknown containers, ports or unset fields', () => {
    expect(exposedPortsOf({ exposed_service: 'nope', exposed_port: 'http' }, data)).toEqual([])
    expect(exposedPortsOf({ exposed_service: 'app', exposed_port: 'nope' }, data)).toEqual([])
    expect(exposedPortsOf({}, data)).toEqual([])
  })
})

describe('restricted deployments with a published port', () => {
  it('lets the ingress path reach only the published port', () => {
    const policy = makeNetworkPolicy('sd-5', {
      ports: [{ name: 'http', port: 80 }, { name: 'admin', port: 9000 }],
      exposedPorts: [{ name: 'admin', port: 9000 }],
    })

    // Ingress path rule exists, restricted to the exposed port
    const pathRule = policy.spec.ingress.at(-1)
    const [traefikPeer, proxyPeer] = pathRule.from
    expect(traefikPeer.namespaceSelector.matchLabels).toEqual({
      'kubernetes.io/metadata.name': 'traefik-v2',
    })
    expect(proxyPeer.podSelector.matchLabels).toEqual({ app: 'service-proxy' })
    expect(pathRule.ports.map((port) => port.port)).toEqual([9000])

    // No rule for other user deployments or the extra ingress namespaces
    const sources = policy.spec.ingress.flatMap((rule) =>
      (rule.from ?? []).map((peer) => peer.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'] ?? null)
    )
    expect(sources).not.toContain('jupyterhub')
  })

  it('publishes nothing for restricted deployments without a published port', () => {
    const policy = makeNetworkPolicy('sd-5', {
      peerNames: [],
      ports: [{ name: 'http', port: 80 }],
    })
    // Only the self rule
    expect(policy.spec.ingress).toHaveLength(1)
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
