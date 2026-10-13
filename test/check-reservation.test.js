import { describe, expect, it } from 'vitest'
import {
  gpuDemandFromDeployment,
  reservedGpuProfiles,
} from '../src/lib/check-reservation.js'

describe('gpuDemandFromDeployment', () => {
  it('sums per gpu resource, factoring in replicas', () => {
    const demand = gpuDemandFromDeployment({
      replicas: 2,
      containers: [
        { gpu: 'nvidia.com/gpu', gpuCount: 2 },
        { gpu: 'nvidia.com/mig-1g.10gb' },
        { image: 'no-gpu' },
      ],
    })
    expect(demand).toEqual({
      'nvidia.com/gpu': 4,
      'nvidia.com/mig-1g.10gb': 2,
    })
  })

  it('defaults to a single replica', () => {
    const demand = gpuDemandFromDeployment({
      containers: [{ gpu: 'nvidia.com/gpu' }],
    })
    expect(demand).toEqual({ 'nvidia.com/gpu': 1 })
  })

  it('is empty for deployments without gpus', () => {
    expect(gpuDemandFromDeployment({ containers: [{ image: 'app' }] })).toEqual(
      {}
    )
  })
})

describe('reservedGpuProfiles', () => {
  it('maps reservation slugs to resources across all rows', () => {
    const profiles = reservedGpuProfiles([
      { gpus: ['gpu-l', 'gpu-s'] },
      { gpus: ['gpu-l'] },
    ])
    expect(profiles).toEqual({
      'nvidia.com/gpu': 2,
      'nvidia.com/mig-2g.20gb': 1,
    })
  })

  it('ignores unknown slugs and missing rows', () => {
    expect(reservedGpuProfiles([{ gpus: ['gpu-xxl'] }, null])).toEqual({})
  })
})
