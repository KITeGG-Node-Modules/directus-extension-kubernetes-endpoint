import { describe, expect, it } from 'vitest'
import { makeConfigMap } from '../src/lib/make-config-map.js'
import { makeSecret } from '../src/lib/make-secret.js'
import { makeService } from '../src/lib/make-service.js'
import { makeVolumeClaim } from '../src/lib/make-volume-claim.js'

describe('makeService', () => {
  it('labels the service and selects the deployment pods', () => {
    const service = makeService('sd-5', 'sd-5-app', [
      { name: 'http', port: 80 },
    ])
    expect(service.metadata.labels).toEqual({ app: 'sd-5' })
    expect(service.spec.selector).toEqual({ app: 'sd-5' })
    expect(service.spec.ports).toHaveLength(1)
  })
})

describe('makeSecret', () => {
  it('labels the secret and carries string data', () => {
    const secret = makeSecret('sd-5', { KEY: 'value' })
    expect(secret.metadata.labels).toEqual({ app: 'sd-5' })
    expect(secret.type).toBe('Opaque')
    expect(secret.stringData).toEqual({ KEY: 'value' })
  })
})

describe('makeConfigMap', () => {
  it('labels the config map', () => {
    const configMap = makeConfigMap('sd-5', { KEY: 'value' })
    expect(configMap.metadata.labels).toEqual({ app: 'sd-5' })
    expect(configMap.data).toEqual({ KEY: 'value' })
  })
})

describe('makeVolumeClaim', () => {
  it('labels the claim and applies access modes', () => {
    const claim = makeVolumeClaim(
      { name: 'mydata', size: '1Gi', type: 'ReadWriteMany' },
      'sd-5'
    )
    expect(claim.metadata.labels).toEqual({ app: 'sd-5' })
    expect(claim.spec.accessModes).toEqual(['ReadWriteMany'])
    expect(claim.spec.resources.requests.storage).toBe('1Gi')
    expect(claim.spec.storageClassName).toBe('longhorn')
  })

  it('normalizes numeric sizes to Gi', () => {
    const claim = makeVolumeClaim({ name: 'mydata', size: 1 }, 'sd-5')
    expect(claim.spec.resources.requests.storage).toBe('1Gi')
  })
})
