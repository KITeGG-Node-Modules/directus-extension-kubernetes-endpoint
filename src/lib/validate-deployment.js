import validate from 'validate.js'
import { validateContainer } from './validate-container.js'

export function validateDeployment(deployment, userGroups = []) {
  let validationErrors = []
  const topLevelErrors = validate(deployment, {
    containers: {
      presence: true,
      type: 'array',
    },
    initContainers: {
      type: 'array',
    },
    replicas: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        lessThanOrEqualTo: 16,
      },
    },
    restartPolicy: {
      type: 'string',
      inclusion: ['Always', 'OnFailure', 'Never'],
    },
  })
  if (topLevelErrors) {
    validationErrors = validationErrors.concat(topLevelErrors)
    return validationErrors
  }

  if (Array.isArray(deployment.initContainers)) {
    for (const container of deployment.initContainers) {
      const containerErrors = validateContainer(container, [], userGroups)
      if (containerErrors && containerErrors.length) {
        validationErrors = validationErrors.concat(containerErrors)
        return validationErrors
      }
    }
  }

  for (const container of deployment.containers) {
    const containerErrors = validateContainer(container, [], userGroups)
    if (containerErrors && containerErrors.length) {
      validationErrors = validationErrors.concat(containerErrors)
      return validationErrors
    }
  }

  if (deployment.volumes) {
    const volumesErrors = validate(deployment, {
      volumes: {
        presence: true,
        type: 'array',
      },
    })
    if (volumesErrors) validationErrors = validationErrors.concat(volumesErrors)
    else {
      for (const volume of deployment.volumes) {
        const volumeErrors = validate(volume, {
          name: {
            presence: true,
            type: 'string',
            format: {
              pattern:
                '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
              message:
                'of volume must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
            },
          },
          size: {
            presence: true,
            type: 'string',
            format: {
              pattern: '^\\d{1,3}(?:Mi|Gi){1}$',
              message: 'must be one to three digits followed by Mi or Gi',
            },
          },
        })
        if (volumeErrors)
          validationErrors = validationErrors.concat(volumeErrors)
      }
    }
  }

  if (validationErrors.length) return validationErrors
}
