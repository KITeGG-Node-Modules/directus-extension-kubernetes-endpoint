import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readNamespacedStatefulSet, listNamespacedPod, listNamespacedPersistentVolumeClaim } =
  vi.hoisted(() => ({
    readNamespacedStatefulSet: vi.fn(),
    listNamespacedPod: vi.fn(),
    listNamespacedPersistentVolumeClaim: vi.fn(),
  }))

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  getKubernetesClient: () => ({
    readNamespacedStatefulSet,
    listNamespacedPod,
    listNamespacedPersistentVolumeClaim,
  }),
}))

import { getDeploymentInfo } from '../src/get-deployment-info.js'

describe('getDeploymentInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readNamespacedStatefulSet.mockResolvedValue({
      body: { status: { replicas: 1, currentReplicas: 1 } },
    })
    listNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: { items: [] },
    })
  })

  it('exposes waiting reasons and messages for containers that never started', async () => {
    listNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: 'sd-5-0' },
            status: {
              phase: 'Pending',
              containerStatuses: [
                {
                  name: 'nginx',
                  ready: false,
                  started: false,
                  restartCount: 7,
                  state: {
                    waiting: {
                      reason: 'CreateContainerConfigError',
                      message:
                        'container has runAsNonRoot and image will run as root (pod: sd-5-0, container: nginx)',
                    },
                  },
                  lastState: {
                    terminated: { reason: 'Error', exitCode: 1 },
                  },
                },
              ],
              initContainerStatuses: [
                {
                  name: 'init',
                  ready: false,
                  started: false,
                  restartCount: 0,
                  state: {
                    waiting: { reason: 'ImagePullBackOff', message: 'Back-off pulling image' },
                  },
                },
              ],
            },
          },
        ],
      },
    })

    const info = await getDeploymentInfo({ id: '5' })
    expect(info.pods[0].phase).toBe('Pending')
    expect(info.pods[0].containers[0]).toEqual({
      name: 'nginx',
      ready: false,
      started: false,
      restartCount: 7,
      waiting: {
        reason: 'CreateContainerConfigError',
        message:
          'container has runAsNonRoot and image will run as root (pod: sd-5-0, container: nginx)',
      },
      lastTermination: { reason: 'Error', exitCode: 1 },
    })
    // init containers fail the same way and block the main containers
    expect(info.pods[0].initContainers[0].waiting).toEqual({
      reason: 'ImagePullBackOff',
      message: 'Back-off pulling image',
    })
  })

  it('returns null waiting/lastTermination for a healthy container', async () => {
    listNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: 'sd-5-0' },
            status: {
              phase: 'Running',
              containerStatuses: [
                {
                  name: 'app',
                  ready: true,
                  started: true,
                  restartCount: 0,
                  state: { running: { startedAt: '2026-10-19T10:00:00Z' } },
                },
              ],
              initContainerStatuses: [],
            },
          },
        ],
      },
    })

    const info = await getDeploymentInfo({ id: '5' })
    expect(info.pods[0].containers[0]).toEqual({
      name: 'app',
      ready: true,
      started: true,
      restartCount: 0,
      waiting: null,
      lastTermination: null,
    })
  })

  it('tolerates pods without status or container statuses', async () => {
    listNamespacedPod.mockResolvedValue({
      body: { items: [{ metadata: { name: 'sd-5-0' } }] },
    })
    const info = await getDeploymentInfo({ id: '5' })
    expect(info.pods[0].containers).toEqual([])
    expect(info.pods[0].initContainers).toEqual([])
  })
})
