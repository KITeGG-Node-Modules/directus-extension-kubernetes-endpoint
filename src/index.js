import { getWorkers } from './get-workers.js'
import { baseRequestHandler } from 'kitegg-directus-extension-common'

export default {
	id: 'kubernetes',
	handler: (router, context) => {
    router.get('/capacity', baseRequestHandler(async () => {
      const workers = await getWorkers()
      const results = []
      for (const worker of workers) {
        const result = { name: worker.name }
        result.available = {}
        for (const key in worker.allocatable) {
          if (key.startsWith('nvidia')) {
            result.available[key] = worker.allocatable[key]
          }
        }
        result.requested = {}
        for (const key in worker.resources.limits) {
          if (key.startsWith('nvidia')) {
            result.requested[key] = worker.resources.limits[key]
          }
        }
        results.push(result)
      }
      return results
    }, context))
	}
}
