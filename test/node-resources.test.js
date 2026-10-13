import { describe, expect, it } from 'vitest'
import { sumPodResources } from '../src/lib/node-resources.js'

function pod(phase, containers, initContainers = []) {
  return {
    status: { phase },
    spec: { containers, initContainers },
  }
}

function resources({ cpu, memory }) {
  const out = {}
  if (cpu != null) out.cpu = cpu
  if (memory != null) out.memory = memory
  return out
}

describe('sumPodResources', () => {
  it('sums main containers in base units', () => {
    const totals = sumPodResources([
      pod('Running', [
        { resources: { limits: resources({ cpu: '500m', memory: '1Gi' }) } },
        { resources: { limits: resources({ cpu: '2', memory: '1Gi' }) } },
      ]),
    ])
    expect(totals.limits.cpu).toBe(2.5)
    expect(totals.limits.memory).toBe(2 * 1024 ** 3)
  })

  it('charges the heavier of main and init containers, not both', () => {
    const totals = sumPodResources([
      pod(
        'Running',
        [{ resources: { limits: resources({ cpu: '2' }) } }],
        [{ resources: { limits: resources({ cpu: '4' }) } }]
      ),
    ])
    expect(totals.limits.cpu).toBe(4)
  })

  it('skips terminated pods', () => {
    const totals = sumPodResources([
      pod('Succeeded', [{ resources: { limits: resources({ cpu: '8' }) } }]),
      pod('Failed', [{ resources: { limits: resources({ cpu: '8' }) } }]),
    ])
    expect(totals.limits.cpu).toBeUndefined()
  })

  it('defaults requests to limits when only limits are set', () => {
    const totals = sumPodResources([
      pod('Running', [{ resources: { limits: resources({ cpu: '1' }) } }]),
    ])
    expect(totals.limits.cpu).toBe(1)
    // Kubernetes defaults unspecified requests to the corresponding
    // limits, so limits-only containers reserve requested capacity too
    expect(totals.requests.cpu).toBe(1)
  })
})
