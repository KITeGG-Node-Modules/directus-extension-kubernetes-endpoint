# KITeGG Kubernetes Endpoint

> K8S control interface for the LLP

## Services Endpoints

### Deploying a service

First, the service needs to be created in the collection `docker_services` in the LLP API.

The required payload for the service is:

```json
{
  "name": "My NGINX Service",
  "deployment": "... valid YAML document (see below) ...",
  "exposed_service": "nginx",
  "exposed_port": 80
}
```

The values for `exposed_service` and `exposed_port` are optional and refer to the values in the YAML below.

The YAML describing the deployment is structured as follows:

```yaml
containers:
  # Mandatory values
  - name: nginx
    image: "nginx:latest"
    ports:
      - name: default
        port: 80
    # Optional fields
    gpu: 'nvidia/gpu'  # Request a GPU resource (see below for valid options)
    # Volume mounts are optional as you can also deploy without persistence
    volumeMounts:
      - name: mydata
        mountPath: /mydata
        # This can optionally be set to read-only
        readOnly: true

# The volumes section is only mandatory if mounts are specified (name has to match)
volumes:
  - name: mydata
    size: 1Gi  # This can be anything between 1-999 Gi or Mi
```

After this has been successfully saved, the service can now be deployed with:

```
PUT /kubernetes/services/<service ID>/deploy
```

This should either return the deployment spec as JSON, or an error code with failed validation or other errors. To update
the deployment config, just send another PUT request after updating the collection.

### Querying a deployment status

After a successful deployment, the service takes a moment to pull images, create volumes, etc. You can get the service
status by querying:

```
GET /kubernetes/services/<service ID>
```

This request returns an object in this format:

```json
{
  "replicas": 1,
  "currentReplicas": 1,
  "pods": [
    {
      "phase": "Pending",
      "containers": [
        {
          "name": "nginx",
          "ready": true,
          "started": true
        }
      ]
    }
  ],
  "volumes": [
    {
      "name": "mydata",
      "phase": "Bound",
      "capacity": "1Gi"
    }
  ]
}
```

### Deleting a deployment

To delete a deployment and all associated resources:

```
DELETE /kubernetes/services/<service ID>
```
