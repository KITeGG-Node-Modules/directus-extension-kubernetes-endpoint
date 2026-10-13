import { describe, expect, it } from 'vitest'
import { parseQuantity } from '../src/lib/quantity.js'

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
