import { describe, expect, it } from 'vitest'
import {
  getDeploymentName,
  getNameSlug,
  handleErrorResponse,
  isSuffixedVolumeName,
  isVolumeClaimOf,
  parseDeploymentData,
  parseScale,
} from '../src/lib/util.js'

describe('getNameSlug', () => {
  it('slugifies titles', () => {
    expect(getNameSlug('My App!')).toBe('my-app')
  })
})

describe('getDeploymentName', () => {
  it('prefixes the slugified id', () => {
    expect(getDeploymentName(5)).toBe('sd-5')
    expect(getDeploymentName('my service')).toBe('sd-my-service')
  })
})

describe('isSuffixedVolumeName', () => {
  it('detects restored claim names', () => {
    expect(
      isSuffixedVolumeName('data-sd-123e4567-e89b-12d3-a456-426614174000-0')
    ).toBe(true)
    expect(isSuffixedVolumeName('mydata')).toBe(false)
    expect(isSuffixedVolumeName('data-sd-not-a-uuid-0')).toBe(false)
  })
})

describe('isVolumeClaimOf', () => {
  it('matches template claim names of the stateful set', () => {
    expect(isVolumeClaimOf('data-sd-5-0', 'sd-5')).toBe(true)
    expect(isVolumeClaimOf('scratch-sd-5-15', 'sd-5')).toBe(true)
    expect(isVolumeClaimOf('data-sd-123e4567-e89b-12d3-a456-426614174000-0', 'sd-123e4567-e89b-12d3-a456-426614174000')).toBe(
      true
    )
  })

  it('rejects claims of other deployments and non-claim names', () => {
    expect(isVolumeClaimOf('data-sd-5-0', 'sd-6')).toBe(false)
    expect(isVolumeClaimOf('data-sd-5-0-extra', 'sd-5')).toBe(false)
    expect(isVolumeClaimOf('data-sd-5-x', 'sd-5')).toBe(false)
    expect(isVolumeClaimOf('data-sd-5', 'sd-5')).toBe(false)
    expect(isVolumeClaimOf('mydata', 'sd-5')).toBe(false)
    expect(isVolumeClaimOf(undefined, 'sd-5')).toBe(false)
  })

  it('does not match restored claim names of other deployments', () => {
    expect(
      isVolumeClaimOf('data-sd-123e4567-e89b-12d3-a456-426614174000-0', 'sd-5')
    ).toBe(false)
  })
})

describe('parseScale', () => {
  it('accepts integers within bounds', () => {
    expect(parseScale('0')).toBe(0)
    expect(parseScale('16')).toBe(16)
  })

  it('rejects out-of-bounds and non-numeric values', () => {
    expect(parseScale('17')).toBeNull()
    expect(parseScale('-1')).toBeNull()
    expect(parseScale('abc')).toBeNull()
    expect(parseScale('8.5')).toBeNull()
    expect(parseScale(undefined)).toBeNull()
  })
})

describe('parseDeploymentData', () => {
  it('parses YAML data', () => {
    expect(parseDeploymentData({ data: 'replicas: 2' })).toEqual({
      replicas: 2,
    })
  })

  it('throws a 400-mapped error for invalid YAML', () => {
    try {
      parseDeploymentData({ data: 'a: [unclosed' })
      expect.unreachable()
    } catch (err) {
      expect(err.statusCode).toBe(400)
      expect(err.extensions.code).toBe('INVALID_PAYLOAD')
    }
  })
})

describe('handleErrorResponse', () => {
  const res = {
    status(code) {
      this.code = code
      return this
    },
  }

  it('maps Kubernetes errors to status and detail', () => {
    const body = handleErrorResponse(res, {
      body: { code: 422, message: 'invalid spec' },
    })
    expect(res.code).toBe(422)
    expect(body.message).toBe('api_errors.kubernetes_error')
    expect(body.detail).toBe('invalid spec')
  })

  it('maps Directus error codes', () => {
    const body = handleErrorResponse(res, {
      statusCode: 403,
      extensions: { code: 'FORBIDDEN' },
      message: 'nope',
    })
    expect(res.code).toBe(403)
    expect(body.message).toBe('api_errors.forbidden')
  })

  it('falls back to 500 for unknown errors', () => {
    const body = handleErrorResponse(res, new Error('boom'))
    expect(res.code).toBe(500)
    expect(body.message).toBe('api_errors.internal_error')
  })

  it('never crashes on a missing status code', () => {
    const body = handleErrorResponse(res, { body: { message: 'x' } })
    expect(res.code).toBe(500)
    expect(body.detail).toBe('x')
  })
})
