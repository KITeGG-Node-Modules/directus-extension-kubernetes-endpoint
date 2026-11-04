import validate from 'validate.js'
import { imageRegistryAllowlist } from './config.js'
import { ALLOWED_CAPABILITIES, NUMBER_UNITS } from './constants.js'
import { GPU_RESOURCE_NAMES } from './gpu-profiles.js'
import { formatQuantity, parseQuantity } from './quantity.js'

const GIB = 1024 ** 3

// Kubernetes identifier conventions for the fields mapped below.
// validate.js' format rule enforces a full-string match, so no anchors.

// Port names are IANA service names: RFC 1035 labels of at most 15
// characters, starting with a letter (length is capped by the
// `length` rule on the port name)
const PORT_NAME_PATTERN = '[a-z]([-a-z0-9]*[a-z0-9])?'

// Environment variable names must not start with a digit and may only
// contain letters, digits, '_', '-' and '.'
const ENV_VAR_NAME_PATTERN = '[-._a-zA-Z][-._a-zA-Z0-9]*'

// Secret/ConfigMap keys — same restriction put-secret/put-config apply
// to the uploaded keys themselves
const DATA_KEY_PATTERN = '[-._a-zA-Z0-9]+'

// Sanity subset of the Docker image reference grammar: lowercase path
// components, optional registry host[:port], tag and/or digest, no
// whitespace. The API server validates the reference authoritatively —
// this only catches obviously malformed values client-side.
const IMAGE_REFERENCE_PATTERN =
  '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?::[0-9]+)?' +
  '(?:/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*' +
  '(?::[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127})?' +
  '(?:@[a-zA-Z0-9]+(?:[.+_-][a-zA-Z0-9]+)*:[a-fA-F0-9]+)?'

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
      // DNS-1123 label limit; longer names also break the derived
      // per-container service name (<statefulSet>-<container>)
      length: {
        maximum: 63,
        message: 'of container must be at most 63 characters',
      },
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
      format: {
        pattern: IMAGE_REFERENCE_PATTERN,
        message:
          'must be a valid image reference (lowercase path, optional tag/digest)',
      },
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
        greaterThan: 0,
        lessThanOrEqualTo: isManagement ? 8 : 2,
      },
    },
    // cpu/memory are validated below: they may be numbers (in NUMBER_UNITS
    // units) or Kubernetes quantity strings, which validate.js' single-type
    // rules cannot express
    // Kubernetes rejects negative runAsUser/runAsGroup/fsGroup values
    user: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        greaterThanOrEqualTo: 0,
      },
    },
    group: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        greaterThanOrEqualTo: 0,
      },
    },
    fsUser: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        greaterThanOrEqualTo: 0,
      },
    },
    fsGroup: {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        greaterThanOrEqualTo: 0,
      },
    },
    command: {
      type: 'array',
    },
    args: {
      type: 'array',
    },
    // opt-out key from the non-root-by-default era; honored by
    // make-container (see there)
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

  // command/args must be lists of strings: the client serializes other
  // element types as JSON numbers/objects, which the API server rejects
  for (const attribute of ['command', 'args']) {
    if (
      Array.isArray(container[attribute]) &&
      container[attribute].some((element) => typeof element !== 'string')
    ) {
      validationErrors.push({ [attribute]: ['must be a list of strings'] })
    }
  }

  if (Array.isArray(container.ports)) {
    for (const port of container.ports) {
      const portErrors = validate(port, {
        name: {
          presence: true,
          type: 'string',
          length: {
            maximum: 15,
            message:
              'of port must be at most 15 characters (IANA service name)',
          },
          format: {
            pattern: PORT_NAME_PATTERN,
            message:
              'of port must be a lowercase IANA service name (a-z,0-9,-, starting with a letter)',
          },
        },
        port: {
          presence: true,
          type: 'integer',
          numericality: {
            strict: true,
            noStrings: true,
            onlyInteger: true,
            greaterThan: 0,
            lessThanOrEqualTo: 65535,
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
          format: {
            pattern: ENV_VAR_NAME_PATTERN,
            message:
              'of environment variable must only contain letters, digits, _, -, . and not start with a digit',
          },
        },
        value: {
          type: 'string',
        },
        fromSecret: {
          type: 'string',
          format: {
            pattern: DATA_KEY_PATTERN,
            message: 'must be a valid secret key (letters, digits, _, -, .)',
          },
        },
        fromConfig: {
          type: 'string',
          format: {
            pattern: DATA_KEY_PATTERN,
            message:
              'must be a valid config map key (letters, digits, _, -, .)',
          },
        },
      })
      if (envVarErrors) validationErrors = validationErrors.concat(envVarErrors)
      // make-container lets fromSecret win silently — both sources on
      // one variable is always a configuration mistake
      if (envVar.fromSecret != null && envVar.fromConfig != null) {
        validationErrors.push({
          environment: [
            `'${envVar.name}' cannot set both fromSecret and fromConfig`,
          ],
        })
      }
    }
  }

  if (Array.isArray(container.volumeMounts)) {
    // Kubernetes rejects two mounts on the same path within a container
    const mountPaths = new Set()
    for (const volumeMount of container.volumeMounts) {
      const volumeMountErrors = validate(volumeMount, {
        name: {
          presence: true,
          type: 'string',
          length: {
            maximum: 63,
            message: 'of volume mount must be at most 63 characters',
          },
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
      if (typeof volumeMount.mountPath === 'string') {
        if (mountPaths.has(volumeMount.mountPath)) {
          validationErrors.push({
            volumeMounts: [`duplicate mountPath '${volumeMount.mountPath}'`],
          })
        }
        mountPaths.add(volumeMount.mountPath)
      }
    }
  }

  return validationErrors
}
