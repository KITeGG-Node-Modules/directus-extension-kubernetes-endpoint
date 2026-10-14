import { beforeEach, describe, expect, it, vi } from 'vitest'
import { servicesNamespace } from '../src/lib/config.js'
import { createStatefulSet } from '../src/create-stateful-set.js'

const { appsClient, labelExistingVolumeClaims } = vi.hoisted(() => ({
  appsClient: {
    readNamespacedStatefulSet: vi.fn(),
    createNamespacedStatefulSet: vi.fn(),
    replaceNamespacedStatefulSet: vi.fn(),
  },
  labelExistingVolumeClaims: vi.fn(),
}))

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  getKubernetesClient: vi.fn(() => appsClient),
}))

vi.mock('../src/lib/label-volume-claims.js', () => ({
  labelExistingVolumeClaims,
}))

const statefulSetName = 'sd-5'

function payload(templateNames) {
  return {
    metadata: { name: statefulSetName },
    spec: {
      serviceName: statefulSetName,
      volumeClaimTemplates: templateNames.map((name) => ({
        metadata: { name, labels: { app: statefulSetName } },
      })),
    },
  }
}

function stored(templateNames) {
  return {
    body: {
      spec: {
        // Unlabeled: created before claims were labeled
        volumeClaimTemplates: templateNames.map((name) => ({
          metadata: { name },
        })),
      },
    },
  }
}

describe('createStatefulSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appsClient.createNamespacedStatefulSet.mockResolvedValue({})
    appsClient.replaceNamespacedStatefulSet.mockResolvedValue({})
  })

  it('creates the stateful set when it does not exist', async () => {
    appsClient.readNamespacedStatefulSet.mockRejectedValue({
      statusCode: 404,
    })
    const statefulSet = payload(['data'])
    await createStatefulSet(statefulSet, statefulSetName)
    expect(appsClient.createNamespacedStatefulSet).toHaveBeenCalledWith(
      servicesNamespace,
      statefulSet
    )
    expect(appsClient.replaceNamespacedStatefulSet).not.toHaveBeenCalled()
    expect(labelExistingVolumeClaims).not.toHaveBeenCalled()
  })

  it('keeps the stored volume claim templates when updating', async () => {
    const existing = stored(['data'])
    appsClient.readNamespacedStatefulSet.mockResolvedValue(existing)
    await createStatefulSet(payload(['data']), statefulSetName)
    const [name, namespace, body] =
      appsClient.replaceNamespacedStatefulSet.mock.calls[0]
    expect(name).toBe(statefulSetName)
    expect(namespace).toBe(servicesNamespace)
    // Stored as-is, including the missing label
    expect(body.spec.volumeClaimTemplates).toEqual(
      existing.body.spec.volumeClaimTemplates
    )
    expect(labelExistingVolumeClaims).toHaveBeenCalledWith(statefulSetName)
  })

  it('rejects adding volume claim templates to an existing stateful set', async () => {
    appsClient.readNamespacedStatefulSet.mockResolvedValue(stored(['data']))
    await expect(
      createStatefulSet(payload(['data', 'scratch']), statefulSetName)
    ).rejects.toMatchObject({
      statusCode: 400,
      extensions: { code: 'INVALID_PAYLOAD' },
    })
    expect(appsClient.replaceNamespacedStatefulSet).not.toHaveBeenCalled()
    expect(labelExistingVolumeClaims).not.toHaveBeenCalled()
  })

  it('does not label claims when no templates are stored', async () => {
    appsClient.readNamespacedStatefulSet.mockResolvedValue(stored([]))
    await createStatefulSet(payload([]), statefulSetName)
    expect(appsClient.replaceNamespacedStatefulSet).toHaveBeenCalledTimes(1)
    expect(labelExistingVolumeClaims).not.toHaveBeenCalled()
  })

  it('reads again when the create race was lost', async () => {
    const existing = stored(['data'])
    appsClient.readNamespacedStatefulSet
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValueOnce(existing)
    appsClient.createNamespacedStatefulSet.mockRejectedValue({
      statusCode: 409,
    })
    await createStatefulSet(payload(['data']), statefulSetName)
    expect(appsClient.readNamespacedStatefulSet).toHaveBeenCalledTimes(2)
    const body = appsClient.replaceNamespacedStatefulSet.mock.calls[0][2]
    expect(body.spec.volumeClaimTemplates).toEqual(
      existing.body.spec.volumeClaimTemplates
    )
    expect(labelExistingVolumeClaims).toHaveBeenCalledWith(statefulSetName)
  })

  it('replaces with the payload unchanged when the templates cannot be determined', async () => {
    // The upsert read misses (404), the create loses the race and the
    // re-read fails
    appsClient.readNamespacedStatefulSet
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockRejectedValueOnce({ statusCode: 500 })
    appsClient.createNamespacedStatefulSet.mockRejectedValue({
      statusCode: 409,
    })
    const statefulSet = payload(['data'])
    await createStatefulSet(statefulSet, statefulSetName)
    expect(appsClient.replaceNamespacedStatefulSet).toHaveBeenCalledWith(
      statefulSetName,
      servicesNamespace,
      statefulSet
    )
    expect(labelExistingVolumeClaims).not.toHaveBeenCalled()
  })
})