import { loggerService } from '@logger'
import {
  DEFAULT_CONTEXTCOUNT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MAX_CONTEXT_COUNT,
  UNLIMITED_CONTEXT_COUNT
} from '@renderer/config/constant'
import { isQwenMTModel } from '@renderer/config/models'
import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import { UNKNOWN } from '@renderer/config/translate'
import { getStoreProviders } from '@renderer/hooks/useStore'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { addAssistant } from '@renderer/store/assistants'
import type {
  Assistant,
  AssistantPreset,
  AssistantSettings,
  Model,
  Provider,
  Topic,
  TranslateAssistant,
  TranslateLanguage
} from '@renderer/types'
import { uuid } from '@renderer/utils'

const logger = loggerService.withContext('AssistantService')

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  temperature: DEFAULT_TEMPERATURE,
  enableTemperature: true,
  contextCount: DEFAULT_CONTEXTCOUNT,
  enableMaxTokens: false,
  maxTokens: 0,
  streamOutput: true,
  topP: 1,
  enableTopP: false,
  toolUseMode: 'prompt',
  customParameters: []
}

export function getDefaultAssistant(): Assistant {
  return {
    id: 'default',
    name: i18n.t('chat.default.name'),
    emoji: '😀',
    prompt: '',
    topics: [getDefaultTopic('default')],
    messages: [],
    type: 'assistant',
    defaultModels: [],
    regularPhrases: [], // Added regularPhrases
    settings: DEFAULT_ASSISTANT_SETTINGS
  }
}

export function getDefaultTranslateAssistant(targetLanguage: TranslateLanguage, text: string): TranslateAssistant {
  const model = getTranslateModel()
  const assistant: Assistant = getDefaultAssistant()

  if (!model) {
    logger.error('No translate model')
    throw new Error(i18n.t('translate.error.not_configured'))
  }

  if (targetLanguage.langCode === UNKNOWN.langCode) {
    logger.error('Unknown target language', targetLanguage)
    throw new Error('Unknown target language')
  }

  const settings = {
    temperature: 0.7
  }

  const getTranslateContent = (model: Model, text: string, targetLanguage: TranslateLanguage): string => {
    if (isQwenMTModel(model)) {
      return text // QwenMT models handle raw text directly
    }

    return store
      .getState()
      .settings.translateModelPrompt.replaceAll('{{target_language}}', targetLanguage.value)
      .replaceAll('{{text}}', text)
  }

  const content = getTranslateContent(model, text, targetLanguage)
  const translateAssistant = {
    ...assistant,
    model,
    settings,
    prompt: '',
    targetLanguage,
    content
  } satisfies TranslateAssistant
  return translateAssistant
}

export function getDefaultAssistantSettings() {
  return store.getState().assistants.defaultAssistant.settings
}

export function getDefaultTopic(assistantId: string): Topic {
  return {
    id: uuid(),
    assistantId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: i18n.t('chat.default.topic.name'),
    messages: [],
    isNameManuallyEdited: false
  }
}

export function getDefaultProvider() {
  return getProviderByModel(getDefaultModel())
}

export function getDefaultModel() {
  return store.getState().llm.defaultModel
}

export function getQuickModel() {
  return store.getState().llm.quickModel
}

export function getTranslateModel() {
  return store.getState().llm.translateModel
}

export function getAssistantProvider(assistant: Assistant): Provider {
  const providers = getStoreProviders()
  const provider = providers.find((p) => p.id === assistant.model?.provider)
  return provider || getDefaultProvider()
}

export function getProviderByModel(model?: Model): Provider {
  const providers = getStoreProviders()
  const provider = providers.find((p) => p.id === model?.provider)

  if (!provider) {
    const defaultProvider = providers.find((p) => p.id === getDefaultModel()?.provider)
    return defaultProvider || CHERRYAI_PROVIDER || providers[0]
  }

  return provider
}

export function getProviderByModelId(modelId?: string) {
  const providers = getStoreProviders()
  const _modelId = modelId || getDefaultModel().id
  return providers.find((p) => p.models.find((m) => m.id === _modelId)) as Provider
}

export const getAssistantSettings = (assistant: Assistant): AssistantSettings => {
  const contextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  const getAssistantMaxTokens = () => {
    if (assistant.settings?.enableMaxTokens) {
      const maxTokens = assistant.settings.maxTokens
      if (typeof maxTokens === 'number') {
        return maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS
      }
      return DEFAULT_MAX_TOKENS
    }
    return undefined
  }

  return {
    contextCount: contextCount === MAX_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : contextCount,
    temperature: assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE,
    enableTemperature: assistant?.settings?.enableTemperature ?? true,
    topP: assistant?.settings?.topP ?? 1,
    enableTopP: assistant?.settings?.enableTopP ?? false,
    enableMaxTokens: assistant?.settings?.enableMaxTokens ?? false,
    maxTokens: getAssistantMaxTokens(),
    streamOutput: assistant?.settings?.streamOutput ?? true,
    toolUseMode: assistant?.settings?.toolUseMode ?? 'prompt',
    defaultModel: assistant?.defaultModel ?? undefined,
    reasoning_effort: assistant?.settings?.reasoning_effort ?? undefined,
    customParameters: assistant?.settings?.customParameters ?? []
  }
}

export function getAssistantById(id: string) {
  const assistants = store.getState().assistants.assistants
  return assistants.find((a) => a.id === id)
}

export async function createAssistantFromAgent(agent: AssistantPreset) {
  const assistantId = uuid()
  const topic = getDefaultTopic(assistantId)

  const assistant: Assistant = {
    ...agent,
    id: assistantId,
    name: agent.name,
    emoji: agent.emoji,
    topics: [topic],
    model: agent.defaultModel,
    defaultModels: agent.defaultModels,
    type: 'assistant',
    regularPhrases: agent.regularPhrases || [], // Ensured regularPhrases
    settings: agent.settings || DEFAULT_ASSISTANT_SETTINGS
  }

  store.dispatch(addAssistant(assistant))

  window.toast.success(i18n.t('message.assistant.added.content'))

  return assistant
}
