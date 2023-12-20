// @ts-check

/** @type {import('@starterstack/sam-expand/plugins').Lifecycles} */
export const lifecycles = ['pre:expand']

/** @type {import('@starterstack/sam-expand/plugins').PluginSchema<{ region?: string, 'suffixStage': boolean, 'configEnv'?: string, stage?: string }>} */
export const schema = {
  type: 'object',
  properties: {
    region: {
      type: 'string',
      nullable: true
    },
    stage: {
      type: 'string',
      nullable: true
    },
    'configEnv': {
      type: 'string',
      nullable: true
    },
    'suffixStage': {
      type: 'boolean'
    }
  },
  required: ['suffixStage'],
  additionalProperties: false
}

export const metadataConfig = 'stackStageConfig'

/** @type {import('@starterstack/sam-expand/plugins').Plugin} */
export const lifecycle = async function noop() {}
