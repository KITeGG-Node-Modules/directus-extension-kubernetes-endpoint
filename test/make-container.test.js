import { describe, expect, it } from 'vitest'
import { makeContainer } from '../src/lib/make-container.js'

describe('makeContainer', () => {
  it('always sets cpu/memory limits, even without gpu', () => {
    const container = makeContainer({ name: 'app', image: 'app' }, [])
    expect(container.resources.limits.cpu).toBe(4)
    expect(container.resources.limits.memory).toBe('32Gi')
    expect(Object.keys(container.resources.limits)).toHaveLength(2)
  })

  it('adds the gpu resource on top of cpu/memory', () => {
    const container = makeContainer(
      { name: 'app', image: 'app', gpu: 'nvidia.com/gpu', gpuCount: 2 },
      []
    )
    expect(container.resources.limits['nvidia.com/gpu']).toBe(2)
    expect(container.resources.limits.cpu).toBe(4)
  })

  it('applies runtime user and group', () => {
    const container = makeContainer(
      { name: 'app', image: 'app', user: 1000, group: 1000 },
      []
    )
    expect(container.securityContext.runAsUser).toBe(1000)
    expect(container.securityContext.runAsGroup).toBe(1000)
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
