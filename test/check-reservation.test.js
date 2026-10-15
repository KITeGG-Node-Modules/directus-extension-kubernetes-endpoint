import { describe, expect, it } from 'vitest'
import {
  checkReservation,
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

  it('scales the demand with the given replica count', () => {
    const demand = gpuDemandFromDeployment(
      {
        replicas: 1,
        containers: [{ gpu: 'nvidia.com/gpu', gpuCount: 2 }],
      },
      3
    )
    expect(demand).toEqual({ 'nvidia.com/gpu': 6 })
  })

  it('has no demand for zero replicas', () => {
    expect(
      gpuDemandFromDeployment(
        { replicas: 2, containers: [{ gpu: 'nvidia.com/gpu' }] },
        0
      )
    ).toEqual({})
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

describe('checkReservation', () => {
  function makeCtx(reservations) {
    const queries = []
    class FakeItemsService {
      constructor(collection, options) {
        this.collection = collection
        this.options = options
      }
      async readByQuery(query) {
        queries.push(query)
        return reservations
      }
    }
    const req = { schema: {}, accountability: {} }
    return { req, services: { ItemsService: FakeItemsService }, queries }
  }

  const deployment = {
    id: 'deployment-1',
    data: ['containers:', '  - image: app', '    gpu: nvidia.com/gpu'].join(
      '\n'
    ),
  }
  const deploymentData = {
    containers: [{ image: 'app', gpu: 'nvidia.com/gpu' }],
  }

  it('passes when the demand is covered by the reservations', async () => {
    const { req, services } = makeCtx([{ gpus: ['gpu-l'] }])
    expect(
      await checkReservation(req, services, deployment, deploymentData)
    ).toBe(true)
  })

  it('scales the demand with the given replica count', async () => {
    const { req, services } = makeCtx([{ gpus: ['gpu-l'] }])
    expect(
      await checkReservation(req, services, deployment, deploymentData, {
        replicas: 2,
      })
    ).toBe(false)
  })

  it('always passes for zero replicas', async () => {
    const { req, services, queries } = makeCtx([])
    expect(
      await checkReservation(req, services, deployment, deploymentData, {
        replicas: 0,
      })
    ).toBe(true)
    expect(queries).toEqual([])
  })

  it('falls back to the replica count from the deployment data', async () => {
    const { req, services } = makeCtx([{ gpus: ['gpu-l'] }])
    const stored = {
      replicas: 2,
      containers: [{ image: 'app', gpu: 'nvidia.com/gpu' }],
    }
    expect(await checkReservation(req, services, deployment, stored)).toBe(
      false
    )
  })

  it('parses the deployment data when none is given', async () => {
    const { req, services } = makeCtx([{ gpus: ['gpu-l'] }])
    expect(await checkReservation(req, services, deployment, null)).toBe(true)
  })

  it('passes without gpu demand', async () => {
    const { req, services, queries } = makeCtx([])
    expect(
      await checkReservation(req, services, deployment, {
        containers: [{ image: 'app' }],
      })
    ).toBe(true)
    expect(queries).toEqual([])
  })
})
