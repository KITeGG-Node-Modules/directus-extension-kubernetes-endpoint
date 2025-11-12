import validate from 'validate.js'

export function validateDeployment(deployment, userGroups = []) {
  const isManagement = !!userGroups.find((group) => group.name === 'management')
  const gpuProfiles = [
    'nvidia.com/gpu',
    'nvidia.com/mig-1g.10gb',
    'nvidia.com/mig-2g.20gb',
    'nvidia.com/mig-3g.40gb',
  ]
  const gpuProps = {}
  for (const profile of gpuProfiles) {
    // TODO: These need to be mutually exclusive
    gpuProps[`containers.resources.requests.${profile}`] = {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        lessThanOrEqualTo: isManagement ? 8 : 2,
      },
    }
  }
  const validationErrors = validate(deployment, {
    name: {
      type: 'string',
      format: {
        pattern:
          '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
        message:
          'of container must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
      },
    },
    namespace: {
      type: 'string',
      format: {
        pattern:
          '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
        message:
          'of container must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
      },
    },

    //
    // Containers

    containers: {
      type: 'array',
    },
    'containers.image': {
      type: 'string',
    },
    'containers.command': {
      type: 'array',
    },
    'containers.args': {
      type: 'array',
    },

    //
    // Container Ports

    'containers.ports': {
      type: 'array',
    },
    'containers.ports.name': {
      type: 'string',
    },
    'containers.ports.port': {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        greaterThan: 0,
      },
    },

    //
    // Container Resources

    'containers.resources.requests.cpu': {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
        greaterThanOrEqualTo: 1,
        lessThanOrEqualTo: isManagement ? 256 : 32,
      },
    },
    'containers.resources.requests.memory': {
      type: 'number',
      numericality: {
        strict: true,
        noStrings: true,
        greaterThanOrEqualTo: 1,
        lessThanOrEqualTo: isManagement ? 512 : 128,
      },
    },
    ...gpuProps,

    //
    // Container Security

    'containers.securityContext.runAsUser': {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
      },
    },
    'containers.securityContext.runAsGroup': {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
      },
    },
    'containers.securityContext.fsUser': {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
      },
    },
    'containers.securityContext.fsGroup': {
      type: 'integer',
      numericality: {
        strict: true,
        noStrings: true,
        onlyInteger: true,
      },
    },
    'containers.securityContext.fsGroupChangePolicy': {
      type: 'string',
      inclusion: ['Always', 'OnRootMismatch'],
    },

    //
    // Container Env

    'containers.env': {
      type: 'array',
    },
    'containers.env.name': {
      type: 'string',
    },
    'containers.env.value': {
      type: 'string',
    },
    'containers.env.valueFromSecret.name': {
      type: 'string',
    },
    'containers.env.valueFromConfig.key': {
      type: 'string',
    },

    //
    // Volumes

    volumes: {
      type: 'array',
    },
    'containers.volumeMounts': {
      type: 'array',
    },
    'volumes.name': {
      presence: true,
      type: 'string',
      format: {
        pattern:
          '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*',
        message: 'of volume must be a lowercase RFC1123 hostname (a-z,0-9,-,.)',
      },
    },
    'volumes.size': {
      presence: true,
      type: 'string',
      format: {
        pattern: '^\\d{1,3}(?:Mi|Gi){1}$',
        message: 'must be one to three digits followed by Mi or Gi',
      },
    },
  })

  if (validationErrors.length) return validationErrors
}
