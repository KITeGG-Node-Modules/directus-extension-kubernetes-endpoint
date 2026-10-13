import { describe, expect, it } from 'vitest'
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
})
