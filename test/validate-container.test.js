import { describe, expect, it } from 'vitest'
import { validateContainer } from '../src/lib/validate-container.js'

describe('validateContainer', () => {
  it('accepts a minimal container', () => {
    expect(validateContainer({ name: 'nginx', image: 'nginx:latest' })).toEqual(
      []
    )
  })

  it('rejects invalid gpu resources', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      gpu: 'nvidia.com/mig-9g',
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('caps gpuCount by group membership', () => {
    const base = { name: 'app', image: 'app', gpu: 'nvidia.com/gpu' }
    expect(validateContainer({ ...base, gpuCount: 2 })).toEqual([])
    expect(
      validateContainer({ ...base, gpuCount: 8 }, [], []).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, gpuCount: 8 }, [], [{ name: 'management' }])
    ).toEqual([])
  })

  it('requires memory of at least 1', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      memory: 0.5,
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('accepts capacity values as numbers or quantity strings', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, cpu: 8, memory: 2 })).toEqual([])
    expect(validateContainer({ ...base, cpu: '8', memory: '2' })).toEqual([])
    expect(validateContainer({ ...base, cpu: '1500m', memory: '2Gi' })).toEqual(
      []
    )
    expect(validateContainer({ ...base, cpu: '2', memory: '1536Mi' })).toEqual(
      []
    )
  })

  it('rejects quantity strings outside the capacity bounds', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, cpu: '1500' }).length).toBeGreaterThan(
      0
    ) // 1500 cores > 32
    expect(
      validateContainer({ ...base, memory: '512Mi' }).length
    ).toBeGreaterThan(0) // 0.5 GiB < 1
    expect(
      validateContainer({ ...base, memory: '200Gi' }).length
    ).toBeGreaterThan(0) // > 128
    expect(validateContainer({ ...base, cpu: 1.5 }).length).toBeGreaterThan(0) // numeric cpu stays whole-cores-only
  })

  it('rejects unparseable capacity strings', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, cpu: 'abc' }).length).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, memory: '2GiGi' }).length
    ).toBeGreaterThan(0)
  })

  it('caps quantity strings by group membership', () => {
    const base = { name: 'app', image: 'app', cpu: '256', memory: '512Gi' }
    expect(validateContainer({ ...base }, [], []).length).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base }, [], [{ name: 'management' }])
    ).toEqual([])
  })

  it('validates ports', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      ports: [{ name: 'http', port: 0 }],
    })
    expect(errors.length).toBeGreaterThan(0)
  })
})
