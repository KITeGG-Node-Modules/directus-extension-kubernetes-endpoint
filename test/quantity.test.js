import { describe, expect, it } from 'vitest'
import { formatQuantity, parseQuantity } from '../src/lib/quantity.js'

describe('parseQuantity', () => {
  it('parses plain and suffixed values', () => {
    expect(parseQuantity('8')).toBe(8)
    expect(parseQuantity(8)).toBe(8)
    expect(parseQuantity('500m')).toBe(0.5)
    expect(parseQuantity('0.5')).toBe(0.5)
    expect(parseQuantity('2e3')).toBe(2000)
  })

  it('parses binary suffixes into bytes', () => {
    expect(parseQuantity('1Ki')).toBe(1024)
    expect(parseQuantity('128Mi')).toBe(128 * 1024 ** 2)
    expect(parseQuantity('1Gi')).toBe(1024 ** 3)
  })

  it('rejects garbage', () => {
    expect(parseQuantity('abc')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity(null)).toBeNull()
  })
})

describe('formatQuantity', () => {
  it('interprets numbers in the default unit', () => {
    expect(formatQuantity(4, '')).toBe('4')
    expect(formatQuantity(2, 'Gi')).toBe('2Gi')
    expect(formatQuantity(0.5, 'Gi')).toBe('0.5Gi')
    expect(formatQuantity(128, 'Mi')).toBe('128Mi')
  })

  it('treats plain numeric strings like numbers', () => {
    expect(formatQuantity('4', '')).toBe('4')
    expect(formatQuantity(' 2 ', 'Gi')).toBe('2Gi')
    expect(formatQuantity('0.5', 'Gi')).toBe('0.5Gi')
  })

  it('passes through strings with an explicit unit', () => {
    expect(formatQuantity('500m', '')).toBe('500m')
    expect(formatQuantity('2Gi', 'Gi')).toBe('2Gi')
    expect(formatQuantity('1.5Gi', 'Gi')).toBe('1.5Gi')
  })

  it('rejects values that are not quantities', () => {
    expect(formatQuantity('abc', 'Gi')).toBeNull()
    expect(formatQuantity('2GiGi', 'Gi')).toBeNull()
    expect(formatQuantity('', 'Gi')).toBeNull()
    expect(formatQuantity(NaN, 'Gi')).toBeNull()
    expect(formatQuantity(null, 'Gi')).toBeNull()
    expect(formatQuantity(true, 'Gi')).toBeNull()
  })
})
