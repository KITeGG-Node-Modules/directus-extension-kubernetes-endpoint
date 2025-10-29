import { getCapacity } from './get-capacity.js'

export function registerStatistics(router, context) {
  getCapacity(router, context)
}
