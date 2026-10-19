import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  getKubernetesClient: vi.fn(),
}))
vi.mock('../src/lib/config.js', () => ({
  servicesNamespace: 'test-services',
}))

import { deleteUnreadyStatefulSetPods } from '../src/delete-unready-stateful-set-pods.js'
import { getKubernetesClient } from '../src/lib/get-kubernetes-client.js'

function pod(name, { ready = false, terminating = false } = {}) {
  const conditions = [
    {
      type: 'Ready',
      status: ready ? 'True' : 'False',
    },
  ]
  return {
    metadata: {
      name,
      ...(terminating ? { deletionTimestamp: '2026-10-19T10:00:00Z' } : {}),
    },
    status: { conditions },
  }
}

function makeCoreClient(items) {
  return {
    listNamespacedPod: vi.fn(async () => ({ body: { items } })),
    deleteNamespacedPod: vi.fn(async () => ({})),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('deleteUnreadyStatefulSetPods', () => {
  it('deletes only the pods that never became ready', async () => {
    const coreClient = makeCoreClient([
      pod('sd-deployment-1-0'),
      pod('sd-deployment-1-1', { ready: true }),
      pod('sd-deployment-1-2', { terminating: true }),
    ])
    getKubernetesClient.mockReturnValue(coreClient)

    const deleted = await deleteUnreadyStatefulSetPods('sd-deployment-1')

    expect(deleted).toEqual(['sd-deployment-1-0'])
    expect(coreClient.listNamespacedPod).toHaveBeenCalledWith(
      'test-services',
      undefined,
      undefined,
      undefined,
      undefined,
      'app=sd-deployment-1'
    )
    expect(coreClient.deleteNamespacedPod).toHaveBeenCalledTimes(1)
    expect(coreClient.deleteNamespacedPod).toHaveBeenCalledWith(
      'sd-deployment-1-0',
      'test-services'
    )
  })

  it('deletes nothing for a deployment without pods', async () => {
    const coreClient = makeCoreClient([])
    getKubernetesClient.mockReturnValue(coreClient)

    const deleted = await deleteUnreadyStatefulSetPods('sd-deployment-1')

    expect(deleted).toEqual([])
    expect(coreClient.deleteNamespacedPod).not.toHaveBeenCalled()
  })

  it('deletes nothing when every pod is ready', async () => {
    const coreClient = makeCoreClient([
      pod('sd-deployment-1-0', { ready: true }),
      pod('sd-deployment-1-1', { ready: true }),
    ])
    getKubernetesClient.mockReturnValue(coreClient)

    const deleted = await deleteUnreadyStatefulSetPods('sd-deployment-1')

    expect(deleted).toEqual([])
    expect(coreClient.deleteNamespacedPod).not.toHaveBeenCalled()
  })
})
