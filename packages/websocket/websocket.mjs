// @ts-check

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

/**
 * @typedef {{
 *   connectionAuthorizer?: {
 *     arn: string | Record<string, any>,
 *     identitySource?: string
 *   },
 *   routes: Array<{ logicalId: string, apiId: string | Record<string, any>, routes: string[] }>
 * }} Schema
 **/

/** @type {import('@starterstack/sam-expand/plugins').PluginSchema<Schema>} */
export const schema = {
  type: 'object',
  properties: {
    connectionAuthorizer: {
      type: 'object',
      properties: {
        arn: {
          oneOf: [
            {
              type: 'string',
              nullable: false
            },
            {
              type: 'object',
              nullable: false
            }
          ]
        },
        identitySource: {
          type: 'string',
          nullable: true
        }
      },
      nullable: true,
      additionalProperties: false,
      required: ['arn']
    },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        nullable: false,
        properties: {
          logicalId: {
            type: 'string',
            nullable: false
          },
          apiId: {
            oneOf: [
              {
                type: 'string',
                nullable: false
              },
              {
                type: 'object',
                nullable: false
              }
            ]
          },
          routes: {
            type: 'array',
            nullable: false,
            items: {
              type: 'string',
              nullable: false
            }
          }
        },
        required: ['logicalId', 'routes'],
        additionalProperties: false
      },
      nullable: false,
      additionalProperties: false
    }
  },
  nullable: false,
  required: ['routes'],
  additionalProperties: false
}

export const metadataConfig = 'websocket'

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
// eslint-disable-next-line @typescript-eslint/require-await
export const lifecycle = async function randomizeDeploymentLogicalIds({
  command,
  template,
  log
}) {
  if (command === 'build') {
    /** @type {Schema} */
    const config = template.Metadata.expand.config[metadataConfig]
    for (const { logicalId, routes, apiId } of config.routes) {
      const resource = template.Resources[logicalId]
      if (!resource) {
        throw new TypeError(`resource ${logicalId} not found in template`)
      }
      if (resource.Type !== 'AWS::Serverless::Function') {
        throw new TypeError(
          `resource ${logicalId} must be of type AWS::Serverless::Function`
        )
      }

      const permissionLogicalId = `${logicalId}PermissionWebSockets`
      const integrationLogicalId = `${logicalId}IntegrationWebSockets`
      const authLogicalId = config.connectionAuthorizer
        ? `${logicalId}AuthWebSockets`
        : ''

      if (!template.Resources[permissionLogicalId]) {
        template.Resources[permissionLogicalId] = {
          Type: 'AWS::Lambda::Permission',
          Properties: {
            FunctionName: { 'Fn::GetAtt': [logicalId, 'Arn'] },
            Action: 'lambda:InvokeFunction',
            Principal: 'apigateway.amazonaws.com'
          }
        }
      }
      if (!template.Resources[integrationLogicalId]) {
        template.Resources[integrationLogicalId] = {
          Type: 'AWS::ApiGatewayV2::Integration',
          Properties: {
            ApiId: apiId,
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: {
              'Fn::Sub': `arn:\${AWS::Partition}:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/\${${logicalId}.Arn}/invocations`
            }
          }
        }
      }

      if (
        config.connectionAuthorizer &&
        authLogicalId &&
        !template.Resources[authLogicalId]
      ) {
        template.Resources[authLogicalId] = {
          Type: 'AWS::ApiGatewayV2::Authorizer',
          Properties: {
            ApiId: apiId,
            Name: `${logicalId}WebSocketAuth`,
            AuthorizerType: 'REQUEST',
            AuthorizerUri: {
              'Fn::Join': [
                '',
                [
                  'arn:',
                  {
                    Ref: 'AWS::Partition'
                  },
                  ':apigateway:',
                  {
                    Ref: 'AWS::Region'
                  },
                  ':lambda:path/2015-03-31/functions/',
                  config.connectionAuthorizer.arn,
                  '/invocations'
                ]
              ]
            },
            ...(config.connectionAuthorizer.identitySource && {
              IdentitySource: [config.connectionAuthorizer.identitySource]
            })
          }
        }
      }

      for (const route of routes) {
        if (route === '$connect' && config.connectionAuthorizer) {
          log('Create WebSocket $connect authorizer %O', {
            logicalId,
            route,
            authorizer: config.connectionAuthorizer
          })
        }
        log('Create WebSocket route %O', { logicalId, route })
        template.Resources[`${logicalId}${route.replaceAll(/[^a-z]/gi, '')}`] =
          {
            Type: 'AWS::ApiGatewayV2::Route',
            Properties: {
              ApiId: apiId,
              RouteKey: route,
              ...(route === '$connect' &&
                config.connectionAuthorizer && {
                  AuthorizationType: 'CUSTOM',
                  AuthorizerId: { Ref: authLogicalId }
                }),
              Target: {
                'Fn::Sub': `integrations/\${${integrationLogicalId}}`
              }
            }
          }
      }
    }
  }
}
