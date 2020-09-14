'use strict'

const chalk = require('chalk')

const get = (obj, path, defaultValue) => {
  return path.split('.').filter(Boolean).every(step => !(step && !(obj = obj[step]))) ? obj : defaultValue
}

class ImportApiGatewayPlugin {
  constructor(serverless, options) {
    this.serverless = serverless

    this.provider = this.serverless.providers.aws
    this.serverless.service.provider.apiGateway = get(this.serverless.service, 'provider.apiGateway', {})

    this.config = get(this.serverless.service, 'custom.importApiGateway', {})

    this.hooks = {}

    if (this.config.name) {
      this.config.path = get(this.config, 'path', '/')
      this.config.resources = get(this.config, 'resources', undefined)
      this.hooks['before:package:setupProviderConfiguration'] = this.importApiGateway.bind(this)
    }
  }

  async getRestApiPathIds(restApiId) {
    let pathIds = {}

    const response = await this.provider.request('APIGateway', 'getResources', { limit: 500, restApiId: restApiId })
    if (response.items) {
      for (let resource of response.items) {
        pathIds[resource.path] = resource.id
      }
    }

    return pathIds
  }

  async findRestApiIdByName(name) {
    const response = await this.provider.request('APIGateway', 'getRestApis', { limit: 500 })
    if (response.items) {
      for (let restApi of response.items) {
        if (name === restApi.name) {
          return restApi.id
        }
      }
    }
  }

  async importApiGateway() {
    try {
      const restApiId = await this.findRestApiIdByName(this.config.name)
      if (!restApiId) {
        this.serverless.cli.log(`Unable to find REST API named '${this.config.name}'`)
        return
      }

      const pathIds = await this.getRestApiPathIds(restApiId)

      const rootResourceId = pathIds[this.config.path]
      if (!rootResourceId) {
        this.serverless.cli.log(`Unable to find root resource path (${this.config.path}) for REST API (${restApiId})`)
        return
      }

      // If no paths were passed into this template, try to identify what they should be
      if (this.config.resources === undefined) {
        const newResourcePaths = []
        if (this.serverless.service.functions !== undefined) { // If this serverless.yml has lambda functions
          // Loop through the lambdas and look for http paths, which are connected to the api gateway
          // and add the found paths to `newResourcepaths` IF part of their path already exists.
          for (let [fname, func] of Object.entries(this.serverless.service.functions)) {
            if (func.events !== undefined) {
              for (let event of func.events) {
                if (event.http !== undefined && event.http.path !== undefined) {
                  // We have a new HTTP path that needs to get added to the gateway. Check to see if a similar path already exists. If so, add it.
                  for (let [existingPath, pathId] of Object.entries(pathIds)) {
                    if (event.http.path.startsWith(existingPath)) {
                      newResourcePaths.push(existingPath)
                    }
                  }
                }
              }
            }
          }
          this.config.resources = newResourcePaths
        }

        // If no paths were found in the serverless document, we shouldn't need to do anything.
        // But just in case, let's just use all the paths the API already has instead. It shouldn't hurt anything.
        if (newResourcePaths.length == 0) {
          this.config.resources = Object.keys(pathIds)
        }
      }

      const resourcesToImport = {}
      for (let resourcePath of this.config.resources) {
        const resourceId = pathIds[resourcePath]
        if (!resourceId) {
          this.serverless.cli.log(`Unable to find resource path (${resourcePath}) for REST API (${restApiId})`)
          return
        }

        resourcesToImport[resourcePath] = resourceId
      }

      this.serverless.service.provider.apiGateway.restApiId = restApiId
      this.serverless.service.provider.apiGateway.restApiRootResourceId = rootResourceId
      this.serverless.service.provider.apiGateway.restApiResources = resourcesToImport
      this.serverless.cli.log(`Imported API Gateway (${JSON.stringify(this.serverless.service.provider.apiGateway)})`)
    } catch (e) {
      console.error(chalk.red(`\n-------- Import API Gateway Error --------\n${e.message}`))
    }
  }
}

module.exports = ImportApiGatewayPlugin
