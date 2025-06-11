import validate from 'validate.js'

export function validateContainer(container, validationErrors = []) {
  const gpuProfiles = [
    'nvidia.com/gpu',
    'nvidia.com/mig-1g.10gb',
    'nvidia.com/mig-2g.20gb',
    'nvidia.com/mig-3g.40gb',
  ]
  const containerErrors = validate(container, {
    name: {
      presence: true,
      type: 'string',
      format: {
        pattern:
          '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
        message:
          'of container must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
      },
    },
    image: {
      presence: true,
      type: 'string',
    },
    ports: {
      type: 'array',
    },
    volumeMounts: {
      type: 'array',
    },
    gpu: {
      type: 'string',
      inclusion: gpuProfiles,
    },
    gpuCount: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        lessThanOrEqualTo: 2,
      },
    },
    cpu: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        greaterThanOrEqualTo: 1,
        lessThanOrEqualTo: 32,
      },
    },
    memory: {
      type: 'number',
      numericality: {
        strict: true,
        noStrings: true,
        greaterThanOrEqualTo: 1.0,
        lessThanOrEqualTo: 128.0,
      },
    },
    user: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
      },
    },
    group: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
      },
    },
    fsUser: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
      },
    },
    fsGroup: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
      },
    },
    command: {
      type: 'array',
    },
    args: {
      type: 'array',
    },
  })
  if (containerErrors) {
    validationErrors = validationErrors.concat(containerErrors)
    return validationErrors
  }

  if (Array.isArray(container.ports)) {
    for (const port of container.ports) {
      const portErrors = validate(port, {
        name: {
          presence: true,
          type: 'string',
        },
        port: {
          presence: true,
          type: 'integer',
          numericality: {
            strict: true,
            noStrings: true,
            onlyInteger: true,
            greaterThan: 0,
          },
        },
      })
      if (portErrors) validationErrors = validationErrors.concat(portErrors)
    }
  }

  if (Array.isArray(container.environment)) {
    for (const envVar of container.environment) {
      const envVarErrors = validate(envVar, {
        name: {
          presence: true,
          type: 'string',
        },
        value: {
          type: 'string',
        },
        fromSecret: {
          type: 'string',
        },
        fromConfig: {
          type: 'string',
        },
      })
      if (envVarErrors) validationErrors = validationErrors.concat(envVarErrors)
    }
  }

  if (Array.isArray(container.volumeMounts)) {
    for (const volumeMount of container.volumeMounts) {
      const volumeMountErrors = validate(volumeMount, {
        name: {
          presence: true,
          type: 'string',
          format: {
            pattern:
              '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
            message:
              'of volume mount must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
          },
        },
        mountPath: {
          presence: true,
          type: 'string',
          format: {
            pattern: '^\\/.*',
            message: 'must be an absolute path.',
          },
        },
        readOnly: {
          type: 'boolean',
        },
        type: {
          type: 'string',
          inclusion: ['ReadWriteOnce', 'ReadWriteMany'],
        },
      })
      if (volumeMountErrors)
        validationErrors = validationErrors.concat(volumeMountErrors)
    }
  }

  return validationErrors
}
