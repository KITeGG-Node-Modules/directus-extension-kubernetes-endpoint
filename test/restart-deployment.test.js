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

import { restartDeployment } from '../src/endpoints/restart-deployment.js'
import { getKubernetesClient } from '../src/lib/get-kubernetes-client.js'
import { loadDeployment } from '../src/lib/resolve-deployment.js'

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
    patchNamespacedStatefulSet: vi.fn(async () => ({})),
  }
}

function makeCtx() {
  const itemsService = vi.fn()
  const ctx = {
    req: {
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

async function restart() {
  const { itemsService, ctx } = makeCtx()
  const result = await restartDeployment(ctx)
  return { itemsService, ctx, result }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadDeployment.mockResolvedValue(DEPLOYMENT)
})

describe('restartDeployment', () => {
  it('restarts without a reservation check', async () => {
    const client = makeK8sClient()
    getKubernetesClient.mockReturnValue(client)

    const { itemsService, ctx, result } = await restart()

    expect(result).toEqual({ success: true })
    expect(ctx.res.code).toBeNull()
    // Restarting cannot increase the GPU demand: the same pods are
    // recreated from the same stateful set template, so there is no
    // reservation check and no reservation lookup
    expect(itemsService).not.toHaveBeenCalled()
    expect(client.listNamespacedStatefulSet).toHaveBeenCalledWith(
      'test-services',
      undefined,
      undefined,
      undefined,
      'metadata.name=sd-deployment-1'
    )
    expect(client.patchNamespacedStatefulSet).toHaveBeenCalledTimes(1)
    const [name, namespace, patch, , , , , , options] =
      client.patchNamespacedStatefulSet.mock.calls[0]
    expect(name).toBe('sd-deployment-1')
    expect(namespace).toBe('test-services')
    expect(patch).toEqual([
      {
        op: 'replace',
        path: '/spec/template/metadata/annotations',
        value: { 'llp.kitegg.de/restartedAt': expect.any(String) },
      },
    ])
    expect(options.headers['Content-type']).toBe('application/json-patch+json')
  })

  it('returns not found when the stateful set does not exist', async () => {
    const client = makeK8sClient({ statefulSetExists: false })
    getKubernetesClient.mockReturnValue(client)

    const { ctx, result } = await restart()

    expect(result).toEqual({ message: 'api_errors.not_found' })
    expect(ctx.res.code).toBe(404)
    expect(client.patchNamespacedStatefulSet).not.toHaveBeenCalled()
  })

  it('returns not found when the deployment does not exist', async () => {
    loadDeployment.mockResolvedValue(null)

    const { result } = await restart()

    expect(result).toEqual({ message: 'api_errors.not_found' })
  })
})
