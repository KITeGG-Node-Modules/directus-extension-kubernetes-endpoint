import { describe, expect, it, vi } from 'vitest'
import { validateDeployment } from '../src/lib/validate-deployment.js'

const validDeployment = {
  containers: [{ name: 'nginx', image: 'nginx:latest' }],
}

describe('validateDeployment', () => {
  it('accepts a minimal deployment', () => {
    expect(validateDeployment(validDeployment)).toBeUndefined()
  })

  it('requires containers', () => {
    expect(validateDeployment({ containers: [] })).toEqual([
      { containers: ["Containers can't be blank"] },
    ])
    expect(validateDeployment({})).toEqual([
      { containers: ["Containers can't be blank"] },
    ])
  })

  it('rejects fsUser/fsGroup disagreement across containers', () => {
    const errors = validateDeployment({
      containers: [
        { name: 'a', image: 'a', fsUser: 1000 },
        { name: 'b', image: 'b', fsUser: 2000 },
      ],
    })
    expect(errors).toEqual([
      { containers: ['fsUser must be the same for all containers'] },
    ])
  })

  it('rejects containers failing their own validation', () => {
    const errors = validateDeployment({
      containers: [{ name: 'My App', image: 'nginx' }],
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects replicas out of bounds', () => {
    const errors = validateDeployment({
      ...validDeployment,
      replicas: 32,
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects volumes that would be silently dropped', () => {
    const errors = validateDeployment({
      ...validDeployment,
      volumes: [{ name: 'mydata' }],
    })
    expect(errors).toEqual([
      { volumes: ["'mydata' needs a size or an emptyDir.sizeLimit"] },
    ])
  })

  it('accepts sized, emptyDir and suffixed volumes', () => {
    const errors = validateDeployment({
      ...validDeployment,
      volumes: [
        { name: 'mydata', size: '1Gi' },
        { name: 'scratch', emptyDir: { sizeLimit: 128 } },
        { name: 'restored-sd-123e4567-e89b-12d3-a456-426614174000-0' },
      ],
    })
    expect(errors).toBeUndefined()
  })

  it('accepts numeric volume sizes and quantity strings', () => {
    const errors = validateDeployment({
      ...validDeployment,
      volumes: [
        { name: 'mydata', size: 50 },
        { name: 'scratch', emptyDir: { sizeLimit: '128Mi' } },
      ],
    })
    expect(errors).toBeUndefined()
  })

  it('rejects volume sizes outside 1Mi-999Gi', () => {
    const errors = validateDeployment({
      ...validDeployment,
      volumes: [
        { name: 'big', size: 1000 },
        { name: 'weird', size: '512Ki' },
        { name: 'huge', emptyDir: { sizeLimit: '1Gi' } },
      ],
    })
    expect(errors).toHaveLength(3)
  })

  it('rejects mounts without a matching volume', () => {
    const errors = validateDeployment({
      containers: [
        {
          name: 'nginx',
          image: 'nginx',
          volumeMounts: [{ name: 'nope', mountPath: '/data' }],
        },
      ],
      volumes: [{ name: 'mydata', size: '1Gi' }],
    })
    expect(errors).toEqual([
      { containers: ["volume mount 'nope' has no matching volume"] },
    ])
  })

  it('rejects duplicate port names across the pod', () => {
    const errors = validateDeployment({
      containers: [
        { name: 'a', image: 'a', ports: [{ name: 'http', port: 80 }] },
        { name: 'b', image: 'b', ports: [{ name: 'http', port: 8080 }] },
      ],
    })
    expect(errors).toEqual([{ containers: ["duplicate port name 'http'"] }])
  })

  it('rejects duplicate port names within one container', () => {
    const errors = validateDeployment({
      containers: [
        {
          name: 'a',
          image: 'a',
          ports: [
            { name: 'http', port: 80 },
            { name: 'http', port: 8080 },
          ],
        },
      ],
    })
    expect(errors).toEqual([{ containers: ["duplicate port name 'http'"] }])
  })

  it('rejects duplicate volume names', () => {
    const errors = validateDeployment({
      ...validDeployment,
      volumes: [
        { name: 'data', size: '1Gi' },
        { name: 'data', size: '2Gi' },
      ],
    })
    expect(errors).toEqual([{ volumes: ["duplicate volume name 'data'"] }])
  })

  it('caps volume name lengths at 63 characters', () => {
    const errors = validateDeployment({
      ...validDeployment,
      volumes: [{ name: 'a'.repeat(64), size: '1Gi' }],
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('validates volume access modes against the storage class allowlist', () => {
    // default allowlist (Longhorn): ReadWriteOnce and ReadWriteMany
    expect(
      validateDeployment({
        ...validDeployment,
        volumes: [{ name: 'data', size: '1Gi', type: 'ReadWriteMany' }],
      })
    ).toBeUndefined()
    const errors = validateDeployment({
      ...validDeployment,
      volumes: [{ name: 'data', size: '1Gi', type: 'ReadWriteOnceMany' }],
    })
    expect(errors.length).toBeGreaterThan(0)
    // canonical but not provisioned by the default storage class
    const unsupported = validateDeployment({
      ...validDeployment,
      volumes: [{ name: 'data', size: '1Gi', type: 'ReadOnlyMany' }],
    })
    expect(unsupported[0].type[0]).toContain("storage class 'longhorn'")
    expect(unsupported[0].type[0]).toContain('ReadWriteOnce, ReadWriteMany')
  })

  it("allows any canonical access mode when the allowlist is '*'", async () => {
    vi.stubEnv('ALLOWED_VOLUME_ACCESS_MODES', '*')
    vi.resetModules()
    try {
      const { validateDeployment: validate } = await import(
        '../src/lib/validate-deployment.js'
      )
      expect(
        validate({
          ...validDeployment,
          volumes: [{ name: 'data', size: '1Gi', type: 'ReadOnlyMany' }],
        })
      ).toBeUndefined()
      expect(
        validate({
          ...validDeployment,
          volumes: [{ name: 'data', size: '1Gi', type: 'ReadWriteBogus' }],
        }).length
      ).toBeGreaterThan(0)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
