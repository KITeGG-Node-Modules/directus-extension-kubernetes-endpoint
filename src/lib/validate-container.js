import validate from 'validate.js'
import { imageRegistryAllowlist } from './config.js'
import { ALLOWED_CAPABILITIES, NUMBER_UNITS } from './constants.js'
import { GPU_RESOURCE_NAMES } from './gpu-profiles.js'
import { formatQuantity, parseQuantity } from './quantity.js'

const GIB = 1024 ** 3

/**
 * The registry of a Docker image reference, lowercased. A leading path
 * component counts as a registry host only when the reference has at
 * least two path segments AND that component contains a dot or a colon
 * or is `localhost` — so 'pytorch/pytorch' and 'nginx:latest' live on
 * docker.io, while 'nvcr.io/nvidia/cuda' and 'my-reg.lan:5000/app'
 * carry their own hosts. Digest references ('ubuntu@sha256:...') are
 * handled before the ':' check, since the digest's colon is not a port.
 */
export function imageRegistry(image) {
  if (typeof image !== 'string' || image === '') return null
  const [reference] = image.split('@', 1)
  const [firstSegment, secondSegment] = reference.split('/')
  if (secondSegment === undefined) return 'docker.io'
  const isRegistry =
    firstSegment.includes('.') ||
    firstSegment.includes(':') ||
    firstSegment === 'localhost'
  return (isRegistry ? firstSegment : 'docker.io').toLowerCase()
}

function validateImageRegistry(container, validationErrors) {
  if (imageRegistryAllowlist == null) return validationErrors
  const registry = imageRegistry(container.image)
  if (registry == null) {
    validationErrors.push({ image: ['must be an image reference'] })
    return validationErrors
  }
  if (!imageRegistryAllowlist.includes(registry)) {
    validationErrors.push({
      image: [
        `registry '${registry}' is not allowed — allowed registries: ${imageRegistryAllowlist.join(', ')}`,
      ],
    })
  }
  return validationErrors
}

function validateCapabilities(container, validationErrors) {
  if (container.capabilities == null) return validationErrors
  if (!Array.isArray(container.capabilities)) {
    validationErrors.push({ capabilities: ['must be a list of capabilities'] })
    return validationErrors
  }
  for (const capability of container.capabilities) {
    if (!ALLOWED_CAPABILITIES.includes(capability)) {
      validationErrors.push({
        capabilities: [
          `'${capability}' is not an allowed capability — allowed: ${ALLOWED_CAPABILITIES.join(', ')}`,
        ],
      })
    }
  }
  return validationErrors
}

// Capacity values may be numbers (interpreted in NUMBER_UNITS) or
// Kubernetes quantity strings ('500m', '2Gi'); both forms are
// bounds-checked against the same policy in base units.
function validateCpu(container, maxCores, validationErrors) {
  if (container.cpu == null) return validationErrors
  // Numeric cpu keeps its historical whole-cores contract; quantity
  // strings like '1500m' express fractional cores instead
  if (typeof container.cpu === 'number' && !Number.isInteger(container.cpu)) {
    validationErrors.push({ cpu: ['must be a whole number of cores'] })
    return validationErrors
  }
  const cores = parseQuantity(formatQuantity(container.cpu, NUMBER_UNITS.cpu))
  if (cores == null) {
    validationErrors.push({
      cpu: [
        'must be a number of cores or a Kubernetes CPU quantity (e.g. 2 or 1500m)',
      ],
    })
    return validationErrors
  }
  if (cores < 1 || cores > maxCores) {
    validationErrors.push({ cpu: [`must be between 1 and ${maxCores} cores`] })
  }
  return validationErrors
}

function validateMemory(container, maxGib, validationErrors) {
  if (container.memory == null) return validationErrors
  const bytes = parseQuantity(
    formatQuantity(container.memory, NUMBER_UNITS.memory)
  )
  if (bytes == null) {
    validationErrors.push({
      memory: [
        'must be a number of GiB or a Kubernetes memory quantity (e.g. 2Gi)',
      ],
    })
    return validationErrors
  }
  if (bytes < GIB || bytes > maxGib * GIB) {
    validationErrors.push({ memory: [`must be between 1 and ${maxGib} GiB`] })
  }
  return validationErrors
}

export function validateContainer(
  container,
  validationErrors = [],
  userGroups = []
) {
  const isManagement = !!userGroups.find((group) => group.name === 'management')
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
      inclusion: GPU_RESOURCE_NAMES,
    },
    gpuCount: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        lessThanOrEqualTo: isManagement ? 8 : 2,
      },
    },
    // cpu/memory are validated below: they may be numbers (in NUMBER_UNITS
    // units) or Kubernetes quantity strings, which validate.js' single-type
    // rules cannot express
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
    runAsRoot: {
      type: 'boolean',
    },
    seccomp: {
      type: 'boolean',
    },
    capabilities: {
      type: 'array',
    },
  })
  if (containerErrors) {
    validationErrors = validationErrors.concat(containerErrors)
    return validationErrors
  }

  validateCpu(container, isManagement ? 256 : 32, validationErrors)
  validateMemory(container, isManagement ? 512 : 128, validationErrors)
  validateImageRegistry(container, validationErrors)
  validateCapabilities(container, validationErrors)
  if (validationErrors.length) return validationErrors

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
