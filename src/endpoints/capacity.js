import { getClusterCapacity } from '../get-cluster-capacity.js'
import { handleErrorResponse } from '../lib/util.js'

export async function getCapacity({ res }) {
  try {
    return await getClusterCapacity()
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
