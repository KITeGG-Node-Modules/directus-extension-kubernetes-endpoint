import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteDeployment } from '../src/delete-deployment.js'

const { client } = vi.hoisted(() => ({
  client: {
    deleteNamespacedStatefulSet: vi.fn(),
    listNamespacedService: vi.fn(),
    deleteNamespacedService: vi.fn(),
    listNamespacedNetworkPolicy: vi.fn(),
    deleteNamespacedNetworkPolicy: vi.fn(),
    listNamespacedPersistentVolumeClaim: vi.fn(),
    deleteNamespacedPersistentVolumeClaim: vi.fn(),
    listNamespacedSecret: vi.fn(),
    deleteNamespacedSecret: vi.fn(),
    listNamespacedConfigMap: vi.fn(),
    deleteNamespacedConfigMap: vi.fn(),
  },
}))

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  getKubernetesClient: vi.fn(() => client),
}))

describe('deleteDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.deleteNamespacedStatefulSet.mockResolvedValue({})
    client.listNamespacedService.mockResolvedValue({ body: { items: [] } })
    client.listNamespacedNetworkPolicy.mockResolvedValue({
      body: { items: [] },
    })
    client.listNamespacedSecret.mockResolvedValue({ body: { items: [] } })
    client.listNamespacedConfigMap.mockResolvedValue({ body: { items: [] } })
    client.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: { items: [] },
    })
  })

  it('deletes unlabeled volume claims of the deployment by name', async () => {
    // The first list call takes the label selector, the second the name
    // fallback
    client.listNamespacedPersistentVolumeClaim
      .mockResolvedValueOnce({
        body: {
          items: [
            { metadata: { name: 'data-sd-5-0', labels: { app: 'sd-5' } } },
          ],
        },
      })
      .mockResolvedValueOnce({
        body: {
          items: [
            { metadata: { name: 'data-sd-5-1' } }, // unlabeled → deleted
            { metadata: { name: 'data-sd-6-0' } }, // other deployment → kept
            { metadata: { name: 'mydata' } }, // not a template claim → kept
            { metadata: { name: 'data-sd-5-x' } }, // not an ordinal → kept
          ],
        },
      })
    await deleteDeployment({ id: 5 })
    const deleted = client.deleteNamespacedPersistentVolumeClaim.mock.calls.map(
      (call) => call[0]
    )
    expect(deleted).toEqual(['data-sd-5-0', 'data-sd-5-1'])
  })

  it('surfaces the first error after best-effort cleanup', async () => {
    const err = { statusCode: 403, body: { code: 403, message: 'forbidden' } }
    client.listNamespacedPersistentVolumeClaim.mockRejectedValue(err)
    await expect(deleteDeployment({ id: 5 })).rejects.toBe(err)
  })

  it('ignores already-deleted resources', async () => {
    client.deleteNamespacedStatefulSet.mockRejectedValue({ statusCode: 404 })
    client.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: { items: [{ metadata: { name: 'data-sd-5-0' } }] },
    })
    client.deleteNamespacedPersistentVolumeClaim.mockRejectedValue({
      statusCode: 404,
    })
    await expect(deleteDeployment({ id: 5 })).resolves.toBeUndefined()
  })
})