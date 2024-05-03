import validate from 'validate.js'

export function validateDeployment(deployment) {
  let validationErrors = []
  const topLevelErrors = validate(deployment, {
    containers: {
      presence: true,
      type: 'array',
    },
  })
  if (topLevelErrors) {
    validationErrors = validationErrors.concat(topLevelErrors)
    return validationErrors
  }

  const gpuProfiles = [
    'nvidia/gpu',
    'nvidia.com/mig-1g.10gb',
    'nvidia.com/mig-2g.20gb',
    'nvidia.com/mig-3g.40gb',
  ]
  for (const container of deployment.containers) {
    const containerErrors = validate(container, {
      name: {
        presence: true,
        type: 'string',
        format: {
          pattern: '[a-z0-9]([-a-z0-9]*[a-z0-9])?',
          message: 'must be a lowercase RFC1123 hostname (a-z,0-9,-)',
        },
      },
      image: {
        presence: true,
        type: 'string',
      },
      ports: {
        presence: true,
        type: 'array',
      },
      volumeMounts: {
        type: 'array',
      },
      gpu: {
        type: 'string',
        inclusion: gpuProfiles,
      },
    })
    if (containerErrors) {
      validationErrors = validationErrors.concat(containerErrors)
      return validationErrors
    }

    for (const port of container.ports) {
      const portErrors = validate(port, {
        name: {
          presence: true,
          type: 'string',
        },
        port: {
          presence: true,
          type: 'number',
        },
      })
      if (portErrors) validationErrors = validationErrors.concat(portErrors)
    }

    if (container.environment) {
      for (const envVar of container.environment) {
        const envVarErrors = validate(envVar, {
          name: {
            presence: true,
            type: 'string',
          },
          value: {
            presence: true,
            type: 'string',
          },
        })
        if (envVarErrors)
          validationErrors = validationErrors.concat(envVarErrors)
      }
    }

    if (container.volumeMounts) {
      for (const volumeMount of container.volumeMounts) {
        const volumeMountErrors = validate(volumeMount, {
          name: {
            presence: true,
            type: 'string',
            format: {
              pattern: '[a-z0-9]([-a-z0-9]*[a-z0-9])?',
              message: 'must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
            },
          },
          mountPath: {
            presence: true,
            type: 'string',
          },
          readOnly: {
            type: 'boolean',
          },
        })
        if (volumeMountErrors)
          validationErrors = validationErrors.concat(volumeMountErrors)
      }
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
              pattern: '[a-z0-9]([-a-z0-9]*[a-z0-9])?',
              message: 'must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
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
