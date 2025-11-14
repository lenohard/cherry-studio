import { ActionIconButton } from '@renderer/components/Buttons'
import type { Assistant, Model, Topic } from '@renderer/types'
import { Tooltip } from 'antd'
import { AtSign } from 'lucide-react'
import type { FC } from 'react'
import type React from 'react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Cache for per-topic default mentions toggle state: `assistantId-topicId` -> boolean
const _defaultMentionsToggleCache: Record<string, boolean | undefined> = {}

interface Props {
  setMentionedModels: React.Dispatch<React.SetStateAction<Model[]>>
  assistant: Assistant
  topic: Topic
}

const MentionModelsButton: FC<Props> = ({ setMentionedModels, assistant, topic }) => {
  const { t } = useTranslation()

  // Per-topic toggle state for default mentions
  const cacheKey = `${assistant.id}-${topic.id}`
  const [isDefaultMentionsEnabled, setIsDefaultMentionsEnabled] = useState<boolean>(() => {
    const cached = _defaultMentionsToggleCache[cacheKey]
    return cached !== undefined ? cached : assistant.enableDefaultModelMentions !== false
  })
  const toggleStateRef = useRef(isDefaultMentionsEnabled)

  useEffect(() => {
    toggleStateRef.current = isDefaultMentionsEnabled
  }, [isDefaultMentionsEnabled])

  // Initialize toggle state from cache when topic changes
  useEffect(() => {
    const cached = _defaultMentionsToggleCache[cacheKey]
    if (cached !== undefined) {
      setIsDefaultMentionsEnabled(cached)
    } else {
      setIsDefaultMentionsEnabled(assistant.enableDefaultModelMentions !== false)
    }
  }, [cacheKey, assistant.enableDefaultModelMentions])

  // Save toggle state to cache when unmounting or topic changes
  useEffect(() => {
    return () => {
      _defaultMentionsToggleCache[cacheKey] = toggleStateRef.current
    }
  }, [cacheKey])

  // Toggle default mentions on/off
  const toggleDefaultMentions = useCallback(() => {
    setIsDefaultMentionsEnabled((prev) => {
      const newState = !prev
      _defaultMentionsToggleCache[cacheKey] = newState

      // Update mentioned models based on new toggle state
      if (newState) {
        // Enable: restore default models
        setMentionedModels(assistant.defaultModels ?? [])
      } else {
        // Disable: clear all mentions
        setMentionedModels([])
      }

      return newState
    })
  }, [assistant.defaultModels, cacheKey, setMentionedModels])

  return (
    <Tooltip
      placement="top"
      title={
        isDefaultMentionsEnabled
          ? t('assistants.settings.default_models.enabled')
          : t('assistants.settings.default_models.disabled')
      }
      mouseLeaveDelay={0}
      arrow>
      <ActionIconButton onClick={toggleDefaultMentions} active={isDefaultMentionsEnabled}>
        <AtSign size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(MentionModelsButton)
