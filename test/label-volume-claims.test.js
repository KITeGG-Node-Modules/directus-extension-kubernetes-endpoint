import { beforeEach, describe, expect, it, vi } from 'vitest'
import { servicesNamespace } from '../src/lib/config.js'
import { labelExistingVolumeClaims } from '../src/lib/label-volume-claims.js'

const { coreClient } = vi.hoisted(() => ({
  coreClient: {
    listNamespacedPersistentVolumeClaim: vi.fn(),
    patchNamespacedPersistentVolumeClaim: vi.fn(),
  },
}))

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  getKubernetesClient: vi.fn(() => coreClient),
}))

function claim(name, labels) {
  return { metadata: { name, labels } }
}

describe('labelExistingVolumeClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coreClient.patchNamespacedPersistentVolumeClaim.mockResolvedValue({})
  })

  it('patches unlabeled claims of the stateful set with the deployment label', async () => {
    coreClient.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: {
        items: [
          claim('data-sd-5-0'),
          claim('scratch-sd-5-1'),
          // Labeled: no patch needed
          claim('data-sd-5-2', { app: 'sd-5' }),
          // Other deployment
          claim('data-sd-6-0'),
          // Not a template claim of any deployment
          claim('mydata'),
          claim('data-sd-5-0-extra'),
        ],
      },
    })
    await labelExistingVolumeClaims('sd-5')
    const calls = coreClient.patchNamespacedPersistentVolumeClaim.mock.calls
    expect(calls.map((call) => call[0])).toEqual(['data-sd-5-0', 'scratch-sd-5-1'])
    for (const call of calls) {
      expect(call[1]).toBe(servicesNamespace)
      expect(call[2]).toEqual({ metadata: { labels: { app: 'sd-5' } } })
      // 9th argument: the patch format must be the Content-Type, the API
      // server rejects PATCH requests without it with 415
      expect(call[8]).toEqual({
        headers: { 'Content-type': 'application/merge-patch+json' },
      })
    }
  })

  it('continues when listing or patching fails', async () => {
    coreClient.listNamespacedPersistentVolumeClaim.mockRejectedValue({
      body: { message: 'forbidden' },
    })
    await expect(labelExistingVolumeClaims('sd-5')).resolves.toBeUndefined()

    coreClient.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: { items: [claim('data-sd-5-0'), claim('scratch-sd-5-1')] },
    })
    coreClient.patchNamespacedPersistentVolumeClaim
      .mockRejectedValueOnce({ body: { message: 'forbidden' } })
      .mockResolvedValueOnce({})
    await expect(labelExistingVolumeClaims('sd-5')).resolves.toBeUndefined()
    // The failing patch only logs; the next claim is still patched
    expect(
      coreClient.patchNamespacedPersistentVolumeClaim
    ).toHaveBeenCalledTimes(2)
  })
})