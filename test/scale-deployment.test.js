import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@kubernetes/client-node', () => ({
  default: {
    AppsV1Api: function AppsV1Api() {},
    PatchUtils: { PATCH_FORMAT_JSON_PATCH: 'application/json-patch+json' },
  },
}))
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
vi.mock('../src/lib/check-reservation.js', () => ({
  checkReservation: vi.fn(),
}))

import { scaleDeployment } from '../src/endpoints/scale-deployment.js'
import { getKubernetesClient } from '../src/lib/get-kubernetes-client.js'
import { loadDeployment } from '../src/lib/resolve-deployment.js'
import { checkReservation } from '../src/lib/check-reservation.js'
import { MAX_REPLICAS } from '../src/lib/constants.js'

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

function makeK8sClient({ statefulSetExists = true } = {}) {
  return {
    listNamespacedStatefulSet: vi.fn(async () => ({
      body: { items: statefulSetExists ? [{}] : [] },
    })),
    patchNamespacedStatefulSetScale: vi.fn(async () => ({})),
  }
}

function makeCtx({ scale } = {}) {
  return {
    req: {
      query: scale === undefined ? {} : { scale },
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
    services: { ItemsService: function ItemsService() {} },
  }
}

async function scaleTo(scale) {
  const ctx = makeCtx({ scale })
  const result = await scaleDeployment(ctx)
  return { ctx, result }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadDeployment.mockResolvedValue(DEPLOYMENT)
  checkReservation.mockReturnValue(true)
})

describe('scaleDeployment', () => {
  it('always allows scaling to 0, without a reservation check', async () => {
    const client = makeK8sClient()
    getKubernetesClient.mockReturnValue(client)
    // The reservation would not cover the deployment: scale to 0 must
    // still succeed, since it frees resources
    checkReservation.mockReturnValue(false)

    const { ctx, result } = await scaleTo('0')

    expect(result).toEqual({ success: true })
    expect(ctx.res.code).toBeNull()
    expect(checkReservation).not.toHaveBeenCalled()
    expect(client.listNamespacedStatefulSet).toHaveBeenCalledWith(
      'test-services',
      undefined,
      undefined,
      undefined,
      'metadata.name=sd-deployment-1'
    )
    expect(client.patchNamespacedStatefulSetScale).toHaveBeenCalledTimes(1)
    const [name, namespace, patch, , , , , , options] =
      client.patchNamespacedStatefulSetScale.mock.calls[0]
    expect(name).toBe('sd-deployment-1')
    expect(namespace).toBe('test-services')
    expect(patch).toEqual([
      { op: 'replace', path: '/spec', value: { replicas: 0 } },
    ])
    expect(options.headers['Content-type']).toBe('application/json-patch+json')
  })

  it('checks the reservation before scaling up', async () => {
    const client = makeK8sClient()
    getKubernetesClient.mockReturnValue(client)

    const { ctx, result } = await scaleTo('2')

    expect(result).toEqual({ success: true })
    expect(ctx.res.code).toBeNull()
    expect(checkReservation).toHaveBeenCalledTimes(1)
    expect(checkReservation).toHaveBeenCalledWith(
      expect.objectContaining({ query: { scale: '2' } }),
      expect.objectContaining({ ItemsService: expect.any(Function) }),
      DEPLOYMENT,
      expect.objectContaining({ replicas: 2 })
    )
    const patch = client.patchNamespacedStatefulSetScale.mock.calls[0][2]
    expect(patch).toEqual([
      { op: 'replace', path: '/spec', value: { replicas: 2 } },
    ])
  })

  it('rejects scaling up when the reservation does not cover the demand', async () => {
    const client = makeK8sClient()
    getKubernetesClient.mockReturnValue(client)
    checkReservation.mockReturnValue(false)

    const { ctx, result } = await scaleTo('2')

    expect(result).toEqual({ message: 'api_errors.not_enough_resources' })
    expect(ctx.res.code).toBe(400)
    expect(client.patchNamespacedStatefulSetScale).not.toHaveBeenCalled()
  })

  it('rejects an invalid scale without checking reservations', async () => {
    const client = makeK8sClient()
    getKubernetesClient.mockReturnValue(client)

    const { ctx, result } = await scaleTo('many')

    expect(result).toEqual({ message: 'api_errors.bad_request' })
    expect(ctx.res.code).toBe(400)
    expect(checkReservation).not.toHaveBeenCalled()
    expect(client.patchNamespacedStatefulSetScale).not.toHaveBeenCalled()
  })

  it('rejects a scale above the replica bound without checking reservations', async () => {
    const client = makeK8sClient()
    getKubernetesClient.mockReturnValue(client)

    const { ctx, result } = await scaleTo(String(MAX_REPLICAS + 1))

    expect(result).toEqual({ message: 'api_errors.bad_request' })
    expect(ctx.res.code).toBe(400)
    expect(checkReservation).not.toHaveBeenCalled()
    expect(client.patchNamespacedStatefulSetScale).not.toHaveBeenCalled()
  })

  it('returns not found when the stateful set does not exist', async () => {
    const client = makeK8sClient({ statefulSetExists: false })
    getKubernetesClient.mockReturnValue(client)

    const { ctx, result } = await scaleTo('0')

    expect(result).toEqual({ message: 'api_errors.not_found' })
    expect(ctx.res.code).toBe(404)
    expect(client.patchNamespacedStatefulSetScale).not.toHaveBeenCalled()
  })

  it('returns bad request when the scale query parameter is missing', async () => {
    const client = makeK8sClient()
    getKubernetesClient.mockReturnValue(client)

    const { ctx, result } = await scaleTo(undefined)

    expect(result).toEqual({ message: 'api_errors.bad_request' })
    expect(ctx.res.code).toBe(400)
    expect(checkReservation).not.toHaveBeenCalled()
    expect(client.patchNamespacedStatefulSetScale).not.toHaveBeenCalled()
  })

  it('returns not found when the deployment does not exist', async () => {
    loadDeployment.mockResolvedValue(null)

    const { result } = await scaleTo('0')

    expect(result).toEqual({ message: 'api_errors.not_found' })
  })
})
