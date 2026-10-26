import { describe, expect, it } from 'vitest'
import { makeContainer } from '../src/lib/make-container.js'
import { ALLOWED_CAPABILITIES } from '../src/lib/constants.js'

describe('makeContainer', () => {
  it('always sets cpu/memory limits, even without gpu', () => {
    const container = makeContainer({ name: 'app', image: 'app' }, [])
    expect(container.resources.limits.cpu).toBe('4')
    expect(container.resources.limits.memory).toBe('32Gi')
    expect(Object.keys(container.resources.limits)).toHaveLength(2)
  })

  it('adds the gpu resource on top of cpu/memory', () => {
    const container = makeContainer(
      { name: 'app', image: 'app', gpu: 'nvidia.com/gpu', gpuCount: 2 },
      []
    )
    expect(container.resources.limits['nvidia.com/gpu']).toBe(2)
    expect(container.resources.limits.cpu).toBe('4')
  })

  it('normalizes numeric and quantity-string capacity values', () => {
    const container = makeContainer(
      { name: 'app', image: 'app', cpu: '1500m', memory: 2 },
      []
    )
    expect(container.resources.limits.cpu).toBe('1500m')
    expect(container.resources.limits.memory).toBe('2Gi')
  })

  it('passes quantity strings through unchanged', () => {
    const container = makeContainer(
      { name: 'app', image: 'app', cpu: '2', memory: '512Mi' },
      []
    )
    expect(container.resources.limits.cpu).toBe('2')
    expect(container.resources.limits.memory).toBe('512Mi')
  })

  it('applies runtime user and group', () => {
    const container = makeContainer(
      { name: 'app', image: 'app', user: 1000, group: 1000 },
      []
    )
    expect(container.securityContext.runAsUser).toBe(1000)
    expect(container.securityContext.runAsGroup).toBe(1000)
  })

  it('hardens the security context by default', () => {
    const container = makeContainer({ name: 'app', image: 'app' }, [])
    // non-root by default, matching plain-Docker-era deployments' security
    // posture (images needing root must opt out via runAsRoot: true)
    expect(container.securityContext.runAsNonRoot).toBe(true)
    expect(container.securityContext.allowPrivilegeEscalation).toBe(false)
    expect(container.securityContext.seccompProfile.type).toBe('RuntimeDefault')
    expect(container.securityContext.capabilities.drop).toEqual(['ALL'])
    // the Docker/containerd default set is granted implicitly, so standard
    // images (e.g. nginx: chown cache dirs, setuid/setgid to nginx) work
    expect(container.securityContext.capabilities.add).toEqual(
      ALLOWED_CAPABILITIES
    )
    expect(ALLOWED_CAPABILITIES).toContain('CHOWN')
    expect(ALLOWED_CAPABILITIES).toContain('NET_BIND_SERVICE')
  })

  it('runs non-root by default and opts out of seccomp per container', () => {
    const root = makeContainer(
      { name: 'app', image: 'app', seccomp: false },
      []
    )
    expect(root.securityContext.runAsNonRoot).toBe(true)
    expect(root.securityContext.seccompProfile).toBeUndefined()

    // non-root default and an explicit user are compatible
    const user = makeContainer({ name: 'app', image: 'app', user: 1000 }, [])
    expect(user.securityContext.runAsNonRoot).toBe(true)
    expect(user.securityContext.runAsUser).toBe(1000)
  })

  it('opts out of non-root with runAsRoot: true', () => {
    const root = makeContainer(
      { name: 'app', image: 'app', runAsRoot: true },
      []
    )
    expect(root.securityContext.runAsNonRoot).toBeUndefined()

    // an explicit false affirms the default: still non-root
    const nonRoot = makeContainer(
      { name: 'app', image: 'app', runAsRoot: false },
      []
    )
    expect(nonRoot.securityContext.runAsNonRoot).toBe(true)
  })

  it('adds requested capabilities on top of the drop of ALL without duplicating the default grant', () => {
    const container = makeContainer(
      { name: 'app', image: 'app', capabilities: ['CHOWN', 'SETUID'] },
      []
    )
    expect(container.securityContext.capabilities.drop).toEqual(['ALL'])
    // CHOWN and SETUID are part of the implicit Docker default grant
    expect(container.securityContext.capabilities.add).toEqual(
      ALLOWED_CAPABILITIES
    )
  })

  it('does not duplicate NET_BIND_SERVICE when requested explicitly', () => {
    const container = makeContainer(
      { name: 'app', image: 'app', capabilities: ['NET_BIND_SERVICE'] },
      []
    )
    expect(container.securityContext.capabilities.add).toEqual(
      ALLOWED_CAPABILITIES
    )
  })

  it('maps secret and config references', () => {
    const container = makeContainer(
      {
        name: 'app',
        image: 'app',
        environment: [
          { name: 'A', value: 'x' },
          { name: 'B', fromSecret: 'b' },
          { name: 'C', fromConfig: 'c' },
        ],
      },
      [],
      'sd-5'
    )
    expect(container.env[0].value).toBe('x')
    expect(container.env[1].valueFrom.secretKeyRef.name).toBe('sd-5')
    expect(container.env[1].valueFrom.secretKeyRef.key).toBe('b')
    expect(container.env[2].valueFrom.configMapKeyRef.key).toBe('c')
  })

  it('registers services only when payloads are collected', () => {
    const payloads = []
    makeContainer(
      { name: 'app', image: 'app', ports: [{ name: 'http', port: 80 }] },
      payloads
    )
    expect(payloads).toEqual([
      { name: 'app', ports: [{ name: 'http', port: 80 }] },
    ])

    // init containers pass no payload collector
    makeContainer(
      { name: 'init', image: 'init', ports: [{ name: 'http', port: 80 }] },
      null
    )
    expect(payloads).toHaveLength(1)
  })
})
