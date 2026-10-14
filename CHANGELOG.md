# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `GET /deployments-running` endpoint listing the ids of deployments that currently have pods in the Running state
- Deployment ownership enforcement on all mutating endpoints: non-admin users can only scale, restart, delete, or change the secret and config of deployments they own. Ownership derives from the deployment's `user_created`, `user_updated` and `authors` fields; `DEPLOYMENT_AUTHORS_FIELD` configures the authors list (an empty value disables that source) and `ENFORCE_DEPLOYMENT_OWNERSHIP=false` disables the check entirely
- Required Kubernetes RBAC documented, with a ready-to-apply `k8s/rbac.yaml` manifest
- Test suite (Vitest), ESLint and CI
- Licensed under the EUPL, Version 1.2

### Changed

- Kubernetes resource creation is now race-tolerant and upserts resources that already exist
- Created resources are labeled and cleaned up by selector on delete
- Containers always get CPU and memory limits set
- Cluster capacity requests accept capacities as numbers or Kubernetes quantity strings
- API error responses are normalized
- The built `dist/index.js` is tracked in the repository so the extension can be installed directly from GitHub

### Fixed

- Kubernetes client cache returning the wrong API client after bundling
- Extension build output to `dist/index.js`
- Pod-level security context type
- Kubernetes quantity parsing in cluster capacity reporting
- Cluster capacity accounting for containers that specify limits only
- Scale query parameter is validated against the replica bounds before use
- Deployment data is parsed before reservation checks, so invalid YAML returns a client error instead of an unhandled 500
- Deployment loading dropped the deployment id by requesting ownership fields only, so every stateful set lookup failed with `statefulsets.apps "sd-undefined" not found`
- Re-deploying a deployment with volumes failed with a Kubernetes `422` (`field is immutable`): the immutable volume claim templates of the existing stateful set are now preserved on update, and adding volumes to an existing deployment returns a client error instead

### Security

- Pod logs, events and deletion are restricted to pods belonging to the deployment itself
