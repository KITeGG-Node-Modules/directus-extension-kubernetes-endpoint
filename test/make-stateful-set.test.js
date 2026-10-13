import k8s from '@kubernetes/client-node'
import { describe, expect, it } from 'vitest'
import { makeStatefulSet } from '../src/lib/make-stateful-set.js'

const deployment = {
  containers: [
    { name: 'app', image: 'app', ports: [{ name: 'http', port: 80 }] },
  ],
}

describe('makeStatefulSet', () => {
  it('builds a stateful set with defaults', () => {
    const { statefulSet, servicePayloads } = makeStatefulSet('sd-5', deployment)
    expect(statefulSet.spec.replicas).toBe(1)
    expect(statefulSet.spec.serviceName).toBe('sd-5')
    expect(statefulSet.spec.selector.matchLabels).toEqual({ app: 'sd-5' })
    expect(statefulSet.spec.template.metadata.labels).toEqual({ app: 'sd-5' })
    expect(statefulSet.spec.template.spec.nodeSelector).toEqual({
      'node-role.kubernetes.io/worker': 'worker',
    })
    expect(servicePayloads).toEqual([
      { name: 'app', ports: [{ name: 'http', port: 80 }] },
    ])
  })

  it('uses a pod security context for filesystem ownership', () => {
    const { statefulSet } = makeStatefulSet('sd-5', {
      containers: [
        {
          name: 'app',
          image: 'app',
          fsUser: 1000,
          fsGroup: 1000,
          changeGroupOnMismatch: true,
        },
      ],
    })
    const securityContext = statefulSet.spec.template.spec.securityContext
    expect(securityContext).toBeInstanceOf(k8s.V1PodSecurityContext)
    expect(securityContext.fsUser).toBe(1000)
    expect(securityContext.fsGroup).toBe(1000)
    expect(securityContext.fsGroupChangePolicy).toBe('OnRootMismatch')
  })

  it('creates volume claim templates for sized volumes', () => {
    const { statefulSet } = makeStatefulSet('sd-5', {
      containers: deployment.containers,
      volumes: [{ name: 'mydata', size: '1Gi' }],
    })
    const [claim] = statefulSet.spec.volumeClaimTemplates
    expect(claim.metadata.name).toBe('mydata')
    expect(claim.metadata.labels).toEqual({ app: 'sd-5' })
    expect(claim.spec.resources.requests.storage).toBe('1Gi')
  })

  it('maps emptyDir volumes and existing claims', () => {
    const { statefulSet } = makeStatefulSet('sd-5', {
      containers: deployment.containers,
      volumes: [
        { name: 'scratch', emptyDir: { sizeLimit: 128 } },
        { name: 'restored-sd-123e4567-e89b-12d3-a456-426614174000-0' },
      ],
    })
    const [emptyDir, existing] = statefulSet.spec.template.spec.volumes
    expect(emptyDir.emptyDir.sizeLimit).toBe('128Mi')
    expect(emptyDir.emptyDir.medium).toBe('Memory')
    expect(existing.persistentVolumeClaim.claimName).toBe(
      'restored-sd-123e4567-e89b-12d3-a456-426614174000-0'
    )
    expect(statefulSet.spec.volumeClaimTemplates).toHaveLength(0)
  })

  it('does not create services for init containers', () => {
    const { servicePayloads } = makeStatefulSet('sd-5', {
      containers: deployment.containers,
      initContainers: [
        { name: 'init', image: 'init', ports: [{ name: 'http', port: 80 }] },
      ],
    })
    expect(servicePayloads).toEqual([
      { name: 'app', ports: [{ name: 'http', port: 80 }] },
    ])
  })
})
