const DECIMAL_SUFFIXES = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
}

const BINARY_SUFFIXES = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
}

const QUANTITY_PATTERN =
  /^(-?\d+(?:\.\d+)?)(n|u|m|Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E|e\d+)?$/

/**
 * Parse a Kubernetes resource quantity (e.g. '500m' CPU, '128Mi' memory,
 * '8' GPUs) into its base value — cores for CPU, bytes for memory.
 * Plain numbers pass through; unparsable input yields null.
 */
export function parseQuantity(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  const match = value.trim().match(QUANTITY_PATTERN)
  if (!match) return null
  const number = parseFloat(match[1])
  const suffix = match[2] ?? ''
  if (suffix.startsWith('e')) {
    return number * 10 ** parseInt(suffix.slice(1), 10)
  }
  const factor = BINARY_SUFFIXES[suffix] ?? DECIMAL_SUFFIXES[suffix]
  if (factor === undefined) return null
  return number * factor
}

const PLAIN_NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/

/**
 * Normalize a user-supplied capacity value into a Kubernetes quantity
 * string. Numbers — and plain numeric strings, which arrive as strings
 * from forms — are interpreted in the given default unit (see
 * NUMBER_UNITS); strings carrying an explicit unit are passed through
 * unchanged as long as they parse as a quantity. Unparsable input
 * yields null.
 */
export function formatQuantity(value, defaultUnit = '') {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `${value}${defaultUnit}` : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (PLAIN_NUMBER_PATTERN.test(trimmed)) {
    return `${trimmed}${defaultUnit}`
  }
  return parseQuantity(trimmed) == null ? null : trimmed
}
