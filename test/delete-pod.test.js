import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  getKubernetesClient: vi.fn(),
}))
vi.mock('../src/lib/config.js', () => ({
  servicesNamespace: 'test-services',
}))
vi.mock('../src/lib/resolve-deployment.js', () => ({
  loadDeployment: vi.fn(),
  isDeploymentOwner: vi.fn(() => true),
}))
vi.mock('../src/lib/get-owned-pod.js', () => ({
  getOwnedPod: vi.fn(),
}))

import { deleteDeploymentPod } from '../src/endpoints/delete-pod.js'
import { getKubernetesClient } from '../src/lib/get-kubernetes-client.js'
import { loadDeployment } from '../src/lib/resolve-deployment.js'
import { getOwnedPod } from '../src/lib/get-owned-pod.js'

const DEPLOYMENT = {
  id: 'deployment-1',
  data: [
    'replicas: 2',
    'containers:',
    '  - image: app',
    '    gpu: nvidia.com/gpu',
    '    gpuCount: 1',
  ].join('\n'),
}

function makeCtx(podName) {
  const itemsService = vi.fn()
  const ctx = {
    req: {
      params: podName === undefined ? {} : { podName },
      schema: {},
      accountability: { user: 'user-1' },
    },
    res: {
      code: null,
      status(code) {
        this.code = code
        return this
      },
    },
    user: { id: 'user-1' },
    services: { ItemsService: itemsService },
  }
  return { itemsService, ctx }
}

async function deletePod(podName) {
  const { itemsService, ctx } = makeCtx(podName)
  const result = await deleteDeploymentPod(ctx)
  return { itemsService, ctx, result }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadDeployment.mockResolvedValue(DEPLOYMENT)
})

describe('deleteDeploymentPod', () => {
  it('deletes a pod without a reservation check', async () => {
    const coreClient = {
      deleteNamespacedPod: vi.fn(async () => ({})),
    }
    getKubernetesClient.mockReturnValue(coreClient)
    getOwnedPod.mockResolvedValue({ metadata: { name: 'sd-deployment-1-0' } })

    const { itemsService, ctx, result } = await deletePod('sd-deployment-1-0')

    expect(result).toEqual({ deleted: 'sd-deployment-1-0' })
    expect(ctx.res.code).toBeNull()
    // Deleting a pod cannot increase the GPU demand: the deleted pod frees
    // its resources and the stateful set recreates it with the same
    // template, so there is no reservation check and no reservation lookup
    expect(itemsService).not.toHaveBeenCalled()
    expect(getOwnedPod).toHaveBeenCalledWith(
      'sd-deployment-1',
      'sd-deployment-1-0'
    )
    expect(coreClient.deleteNamespacedPod).toHaveBeenCalledWith(
      'sd-deployment-1-0',
      'test-services'
    )
  })

  it('returns bad request without a pod name', async () => {
    const coreClient = {
      deleteNamespacedPod: vi.fn(async () => ({})),
    }
    getKubernetesClient.mockReturnValue(coreClient)

    const { ctx, result } = await deletePod(undefined)

    expect(result).toEqual({ message: 'api_errors.pod_name_missing' })
    expect(ctx.res.code).toBe(400)
    expect(getOwnedPod).not.toHaveBeenCalled()
    expect(coreClient.deleteNamespacedPod).not.toHaveBeenCalled()
  })

  it('returns not found when the pod does not belong to the deployment', async () => {
    const coreClient = {
      deleteNamespacedPod: vi.fn(async () => ({})),
    }
    getKubernetesClient.mockReturnValue(coreClient)
    getOwnedPod.mockResolvedValue(null)

    const { ctx, result } = await deletePod('sd-deployment-1-0')

    expect(result).toEqual({ message: 'api_errors.not_found' })
    expect(ctx.res.code).toBe(404)
    expect(coreClient.deleteNamespacedPod).not.toHaveBeenCalled()
  })

  it('returns not found when the deployment does not exist', async () => {
    loadDeployment.mockResolvedValue(null)

    const { result } = await deletePod('sd-deployment-1-0')

    expect(result).toEqual({ message: 'api_errors.not_found' })
  })
})
