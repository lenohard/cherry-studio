import { loggerService } from '@logger'
import {
  isAutoEnableImageGenerationModel,
  isGenerateImageModel,
  isGenerateImageModels,
  isMandatoryWebSearchModel,
  isVisionModel,
  isVisionModels,
  isWebSearchModel
} from '@renderer/config/models'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useInputText } from '@renderer/hooks/useInputText'
import { useMessageOperations, useTopicLoading } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { useTextareaResize } from '@renderer/hooks/useTextareaResize'
import { useTimer } from '@renderer/hooks/useTimer'
import {
  InputbarToolsProvider,
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import FileManager from '@renderer/services/FileManager'
import { checkRateLimit, getUserMessage } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { spanManagerService } from '@renderer/services/SpanManagerService'
import { estimateTextTokens as estimateTxtTokens, estimateUserPromptUsage } from '@renderer/services/TokenService'
import WebSearchService from '@renderer/services/WebSearchService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { sendMessage as _sendMessage } from '@renderer/store/thunk/messageThunk'
import { type Assistant, type FileType, type KnowledgeBase, type Model, type Topic, TopicType } from '@renderer/types'
import type { MessageInputBaseParams } from '@renderer/types/newMessage'
import { delay } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { debounce } from 'lodash'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InputbarCore } from './components/InputbarCore'
import InputbarTools from './InputbarTools'
import KnowledgeBaseInput from './KnowledgeBaseInput'
import MentionModelsInput from './MentionModelsInput'
import { getInputbarConfig } from './registry'
import TokenCount from './TokenCount'

const logger = loggerService.withContext('Inputbar')

const _mentionedModelsCache: Record<string, Model[] | undefined> = {}
const _defaultMentionsToggleCache: Record<string, boolean | undefined> = {}

const areModelListsEqual = (a: Model[], b: Model[]) => {
  if (a.length !== b.length) {
    return false
  }
  const bIds = b.map((model) => getModelUniqId(model))
  return a.every((model, index) => getModelUniqId(model) === bIds[index])
}

interface Props {
  assistant: Assistant
  setActiveTopic: (topic: Topic) => void
  topic: Topic
}

type ProviderActionHandlers = {
  resizeTextArea: () => void
  addNewTopic: () => void
  clearTopic: () => void
  onNewContext: () => void
  onTextChange: (updater: string | ((prev: string) => string)) => void
  toggleExpanded: (nextState?: boolean) => void
  toggleDefaultMentions: () => void
}

interface InputbarInnerProps extends Props {
  actionsRef: React.RefObject<ProviderActionHandlers>
}

const Inputbar: FC<Props> = ({ assistant: initialAssistant, setActiveTopic, topic }) => {
  const actionsRef = useRef<ProviderActionHandlers>({
    resizeTextArea: () => {},
    addNewTopic: () => {},
    clearTopic: () => {},
    onNewContext: () => {},
    onTextChange: () => {},
    toggleExpanded: () => {},
    toggleDefaultMentions: () => {}
  })

  const initialState = useMemo(
    () => ({
      files: [] as FileType[],
      mentionedModels: [] as Model[],
      defaultMentionsEnabled: initialAssistant.enableDefaultModelMentions !== false,
      selectedKnowledgeBases: initialAssistant.knowledge_bases ?? [],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    [initialAssistant.enableDefaultModelMentions, initialAssistant.knowledge_bases]
  )

  return (
    <InputbarToolsProvider
      initialState={initialState}
      actions={{
        resizeTextArea: () => actionsRef.current.resizeTextArea(),
        addNewTopic: () => actionsRef.current.addNewTopic(),
        clearTopic: () => actionsRef.current.clearTopic(),
        onNewContext: () => actionsRef.current.onNewContext(),
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        toggleExpanded: (next) => actionsRef.current.toggleExpanded(next),
        toggleDefaultMentions: () => actionsRef.current.toggleDefaultMentions()
      }}>
      <InputbarInner
        assistant={initialAssistant}
        setActiveTopic={setActiveTopic}
        topic={topic}
        actionsRef={actionsRef}
      />
    </InputbarToolsProvider>
  )
}

const InputbarInner: FC<InputbarInnerProps> = ({ assistant: initialAssistant, setActiveTopic, topic, actionsRef }) => {
  const scope = topic.type ?? TopicType.Chat
  const config = getInputbarConfig(scope)

  const { files, mentionedModels, selectedKnowledgeBases, defaultMentionsEnabled } = useInputbarToolsState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases, setDefaultMentionsEnabled } =
    useInputbarToolsDispatch()
  const { setCouldAddImageFile } = useInputbarToolsInternalDispatch()

  const { text, setText } = useInputText()
  const {
    textareaRef,
    resize: resizeTextArea,
    focus: focusTextarea,
    setExpanded,
    isExpanded: textareaIsExpanded
  } = useTextareaResize({
    maxHeight: 400,
    minHeight: 30
  })

  const showKnowledgeIcon = useSidebarIconShow('knowledge')
  const { assistant, addTopic, model, setModel, updateAssistant } = useAssistant(initialAssistant.id)
  const { sendMessageShortcut, showInputEstimatedTokens, enableQuickPanelTriggers } = useSettings()
  const [estimateTokenCount, setEstimateTokenCount] = useState(0)
  const [contextCount, setContextCount] = useState({ current: 0, max: 0 })

  const { t } = useTranslation()
  const { pauseMessages } = useMessageOperations(topic)
  const loading = useTopicLoading(topic)
  const dispatch = useAppDispatch()
  const isVisionAssistant = useMemo(() => isVisionModel(model), [model])
  const isGenerateImageAssistant = useMemo(() => isGenerateImageModel(model), [model])
  const { setTimeoutTimer } = useTimer()
  const isMultiSelectMode = useAppSelector((state) => state.runtime.chat.isMultiSelectMode)
  const assistantDefaultModels = useMemo(() => assistant.defaultModels ?? [], [assistant.defaultModels])
  const manualMentionUpdateRef = useRef(false)
  const mentionSyncRef = useRef(false)
  const mentionedModelsRef = useRef<Model[]>(mentionedModels)
  const defaultMentionsToggleRef = useRef(defaultMentionsEnabled)

  const isVisionSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isVisionModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isVisionAssistant),
    [mentionedModels, isVisionAssistant]
  )

  const isGenerateImageSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isGenerateImageModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isGenerateImageAssistant),
    [mentionedModels, isGenerateImageAssistant]
  )

  const canAddImageFile = useMemo(() => {
    return isVisionSupported || isGenerateImageSupported
  }, [isGenerateImageSupported, isVisionSupported])

  const canAddTextFile = useMemo(() => {
    return isVisionSupported || (!isVisionSupported && !isGenerateImageSupported)
  }, [isGenerateImageSupported, isVisionSupported])

  const supportedExts = useMemo(() => {
    if (canAddImageFile && canAddTextFile) {
      return [...imageExts, ...documentExts, ...textExts]
    }

    if (canAddImageFile) {
      return [...imageExts]
    }

    if (canAddTextFile) {
      return [...documentExts, ...textExts]
    }

    return []
  }, [canAddImageFile, canAddTextFile])

  useEffect(() => {
    setCouldAddImageFile(canAddImageFile)
  }, [canAddImageFile, setCouldAddImageFile])

  const applyMentionedModels = useCallback(
    (nextModels: Model[]) => {
      mentionSyncRef.current = true
      setMentionedModels(() => nextModels)
    },
    [setMentionedModels]
  )

  useEffect(() => {
    const defaultsEnabled = assistant.enableDefaultModelMentions !== false
    const cached = _mentionedModelsCache[assistant.id]

    if (cached !== undefined) {
      if (!areModelListsEqual(cached, mentionedModelsRef.current)) {
        manualMentionUpdateRef.current = true
        applyMentionedModels(cached)
      }
      return
    }

    manualMentionUpdateRef.current = false

    if (!defaultsEnabled) {
      if (mentionedModelsRef.current.length > 0) {
        applyMentionedModels([])
      }
      return
    }

    if (!areModelListsEqual(assistantDefaultModels, mentionedModelsRef.current)) {
      applyMentionedModels(assistantDefaultModels)
    }
  }, [assistant.id, assistant.enableDefaultModelMentions, assistantDefaultModels, applyMentionedModels])

  useEffect(() => {
    if (manualMentionUpdateRef.current) {
      _mentionedModelsCache[assistant.id] = mentionedModels
    } else {
      delete _mentionedModelsCache[assistant.id]
    }
  }, [assistant.id, mentionedModels])

  useEffect(() => {
    const cacheKey = `${assistant.id}-${topic.id}`
    const cached = _defaultMentionsToggleCache[cacheKey]
    const fallback = assistant.enableDefaultModelMentions !== false
    const next = cached ?? fallback
    if (next !== defaultMentionsEnabled) {
      setDefaultMentionsEnabled(next)
    }
  }, [assistant.enableDefaultModelMentions, assistant.id, defaultMentionsEnabled, setDefaultMentionsEnabled, topic.id])

  useEffect(() => {
    const cacheKey = `${assistant.id}-${topic.id}`
    return () => {
      _defaultMentionsToggleCache[cacheKey] = defaultMentionsToggleRef.current
    }
  }, [assistant.id, topic.id])

  useEffect(() => {
    Object.keys(_defaultMentionsToggleCache).forEach((key) => {
      if (key.startsWith(`${assistant.id}-`)) {
        delete _defaultMentionsToggleCache[key]
      }
    })
  }, [assistant.enableDefaultModelMentions, assistant.id])

  const placeholderText = enableQuickPanelTriggers
    ? t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })
    : t('chat.input.placeholder_without_triggers', {
        key: getSendMessageShortcutLabel(sendMessageShortcut),
        defaultValue: t('chat.input.placeholder', {
          key: getSendMessageShortcutLabel(sendMessageShortcut)
        })
      })

  useEffect(() => {
    mentionedModelsRef.current = mentionedModels
    if (mentionSyncRef.current) {
      mentionSyncRef.current = false
      return
    }
    manualMentionUpdateRef.current = true
  }, [mentionedModels])

  useEffect(() => {
    defaultMentionsToggleRef.current = defaultMentionsEnabled
  }, [defaultMentionsEnabled])

  const toggleDefaultMentions = useCallback(() => {
    setDefaultMentionsEnabled((prev) => {
      const next = !prev
      manualMentionUpdateRef.current = false
      applyMentionedModels(next ? assistantDefaultModels : [])

      const cacheKey = `${assistant.id}-${topic.id}`
      _defaultMentionsToggleCache[cacheKey] = next

      if (assistant.enableDefaultModelMentions !== next) {
        updateAssistant({ enableDefaultModelMentions: next })
      }

      return next
    })
  }, [
    applyMentionedModels,
    assistant.enableDefaultModelMentions,
    assistantDefaultModels,
    setDefaultMentionsEnabled,
    topic.id,
    updateAssistant,
    assistant.id
  ])

  const sendMessage = useCallback(async () => {
    if (checkRateLimit(assistant)) {
      return
    }

    logger.info('Starting to send message')

    const parent = spanManagerService.startTrace(
      { topicId: topic.id, name: 'sendMessage', inputs: text },
      mentionedModels.length > 0 ? mentionedModels : [assistant.model]
    )
    EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id, traceId: parent?.spanContext().traceId })

    try {
      const uploadedFiles = await FileManager.uploadFiles(files)

      const baseUserMessage: MessageInputBaseParams = { assistant, topic, content: text }
      if (uploadedFiles) {
        baseUserMessage.files = uploadedFiles
      }
      if (mentionedModels.length) {
        baseUserMessage.mentions = mentionedModels
      }

      baseUserMessage.usage = await estimateUserPromptUsage(baseUserMessage)

      const { message, blocks } = getUserMessage(baseUserMessage)
      message.traceId = parent?.spanContext().traceId

      dispatch(_sendMessage(message, blocks, assistant, topic.id))

      setText('')
      setFiles([])
      setTimeoutTimer('sendMessage_1', () => setText(''), 500)
      setTimeoutTimer('sendMessage_2', () => resizeTextArea(true), 0)
    } catch (error) {
      logger.warn('Failed to send message:', error as Error)
      parent?.recordException(error as Error)
    }
  }, [assistant, topic, text, mentionedModels, files, dispatch, setText, setFiles, setTimeoutTimer, resizeTextArea])

  const tokenCountProps = useMemo(() => {
    if (!config.showTokenCount || estimateTokenCount === undefined || !showInputEstimatedTokens) {
      return undefined
    }

    return {
      estimateTokenCount,
      inputTokenCount: estimateTokenCount,
      contextCount
    }
  }, [config.showTokenCount, contextCount, estimateTokenCount, showInputEstimatedTokens])

  const onPause = useCallback(async () => {
    await pauseMessages()
  }, [pauseMessages])

  const clearTopic = useCallback(async () => {
    if (loading) {
      await onPause()
      await delay(1)
    }

    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
    focusTextarea()
  }, [focusTextarea, loading, onPause, topic])

  const onNewContext = useCallback(() => {
    if (loading) {
      onPause()
      return
    }
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [loading, onPause])

  const addNewTopic = useCallback(async () => {
    const newTopic = getDefaultTopic(assistant.id)

    await db.topics.add({ id: newTopic.id, messages: [] })

    if (assistant.defaultModel) {
      setModel(assistant.defaultModel)
    }

    delete _mentionedModelsCache[assistant.id]
    manualMentionUpdateRef.current = false
    applyMentionedModels(assistant.enableDefaultModelMentions !== false ? assistantDefaultModels : [])
    setDefaultMentionsEnabled(assistant.enableDefaultModelMentions !== false)
    const newTopicCacheKey = `${assistant.id}-${newTopic.id}`
    _defaultMentionsToggleCache[newTopicCacheKey] = assistant.enableDefaultModelMentions !== false

    addTopic(newTopic)
    setActiveTopic(newTopic)

    setTimeoutTimer('addNewTopic', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  }, [
    addTopic,
    applyMentionedModels,
    assistant.defaultModel,
    assistant.id,
    assistant.enableDefaultModelMentions,
    assistantDefaultModels,
    setActiveTopic,
    setDefaultMentionsEnabled,
    setModel,
    setTimeoutTimer
  ])

  const handleRemoveModel = useCallback(
    (modelToRemove: Model) => {
      setMentionedModels(mentionedModels.filter((current) => current.id !== modelToRemove.id))
    },
    [mentionedModels, setMentionedModels]
  )

  const handleRemoveKnowledgeBase = useCallback(
    (knowledgeBase: KnowledgeBase) => {
      const nextKnowledgeBases = assistant.knowledge_bases?.filter((kb) => kb.id !== knowledgeBase.id)
      updateAssistant({ ...assistant, knowledge_bases: nextKnowledgeBases })
      setSelectedKnowledgeBases(nextKnowledgeBases ?? [])
    },
    [assistant, setSelectedKnowledgeBases, updateAssistant]
  )

  const handleToggleExpanded = useCallback(
    (nextState?: boolean) => {
      const target = typeof nextState === 'boolean' ? nextState : !textareaIsExpanded
      setExpanded(target)
      focusTextarea()
    },
    [focusTextarea, setExpanded, textareaIsExpanded]
  )

  useEffect(() => {
    actionsRef.current = {
      resizeTextArea,
      addNewTopic,
      clearTopic,
      onNewContext,
      onTextChange: setText,
      toggleExpanded: handleToggleExpanded,
      toggleDefaultMentions
    }
  }, [
    resizeTextArea,
    addNewTopic,
    clearTopic,
    onNewContext,
    setText,
    handleToggleExpanded,
    toggleDefaultMentions,
    actionsRef
  ])

  useShortcut(
    'new_topic',
    () => {
      addNewTopic()
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      focusTextarea()
    },
    { preventDefault: true, enableOnFormTags: true }
  )

  useShortcut('clear_topic', clearTopic, {
    preventDefault: true,
    enableOnFormTags: true
  })

  useEffect(() => {
    const _setEstimateTokenCount = debounce(setEstimateTokenCount, 100, { leading: false, trailing: true })
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, ({ tokensCount, contextCount }) => {
        _setEstimateTokenCount(tokensCount)
        setContextCount({ current: contextCount.current, max: contextCount.max })
      }),
      ...[EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic)]
    ]

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [addNewTopic])

  useEffect(() => {
    const debouncedEstimate = debounce((value: string) => {
      if (showInputEstimatedTokens) {
        const count = estimateTxtTokens(value) || 0
        setEstimateTokenCount(count)
      }
    }, 500)

    debouncedEstimate(text)
    return () => debouncedEstimate.cancel()
  }, [showInputEstimatedTokens, text])

  useEffect(() => {
    if (!document.querySelector('.topview-fullscreen-container')) {
      focusTextarea()
    }
  }, [
    topic.id,
    assistant.mcpServers,
    assistant.knowledge_bases,
    assistant.enableWebSearch,
    assistant.webSearchProviderId,
    mentionedModels,
    focusTextarea
  ])

  useEffect(() => {
    setSelectedKnowledgeBases(showKnowledgeIcon ? (assistant.knowledge_bases ?? []) : [])
  }, [assistant.knowledge_bases, setSelectedKnowledgeBases, showKnowledgeIcon])

  useEffect(() => {
    // Disable web search if model doesn't support it
    if (!isWebSearchModel(model) && assistant.enableWebSearch) {
      updateAssistant({ ...assistant, enableWebSearch: false })
    }

    // Clear web search provider if disabled or model has mandatory search
    if (
      assistant.webSearchProviderId &&
      (!WebSearchService.isWebSearchEnabled(assistant.webSearchProviderId) || isMandatoryWebSearchModel(model))
    ) {
      updateAssistant({ ...assistant, webSearchProviderId: undefined })
    }

    // Auto-enable/disable image generation based on model capabilities
    if (isGenerateImageModel(model)) {
      if (isAutoEnableImageGenerationModel(model) && !assistant.enableGenerateImage) {
        updateAssistant({ ...assistant, enableGenerateImage: true })
      }
    } else if (assistant.enableGenerateImage) {
      updateAssistant({ ...assistant, enableGenerateImage: false })
    }
  }, [assistant, model, updateAssistant])

  if (isMultiSelectMode) {
    return null
  }

  // topContent: 所有顶部预览内容
  const topContent = (
    <>
      {selectedKnowledgeBases.length > 0 && (
        <KnowledgeBaseInput
          selectedKnowledgeBases={selectedKnowledgeBases}
          onRemoveKnowledgeBase={handleRemoveKnowledgeBase}
        />
      )}

      {mentionedModels.length > 0 && (
        <MentionModelsInput selectedModels={mentionedModels} onRemoveModel={handleRemoveModel} />
      )}
    </>
  )

  // leftToolbar: 左侧工具栏
  const leftToolbar = config.showTools ? <InputbarTools scope={scope} assistantId={assistant.id} topic={topic} /> : null

  // rightToolbar: 右侧工具栏
  const rightToolbar = (
    <>
      {tokenCountProps && (
        <TokenCount
          estimateTokenCount={tokenCountProps.estimateTokenCount}
          inputTokenCount={tokenCountProps.inputTokenCount}
          contextCount={tokenCountProps.contextCount}
          onClick={onNewContext}
        />
      )}
    </>
  )

  return (
    <InputbarCore
      scope={scope}
      placeholder={placeholderText}
      text={text}
      onTextChange={setText}
      textareaRef={textareaRef}
      resizeTextArea={resizeTextArea}
      focusTextarea={focusTextarea}
      isLoading={loading}
      supportedExts={supportedExts}
      onPause={onPause}
      handleSendMessage={sendMessage}
      leftToolbar={leftToolbar}
      rightToolbar={rightToolbar}
      topContent={topContent}
    />
  )
}

export default Inputbar
