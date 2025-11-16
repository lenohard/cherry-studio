import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type { FileType, Model } from '@renderer/types'
import type React from 'react'

import MentionModelsButton from './components/MentionModelsButton'
import MentionModelsQuickPanelManager from './components/MentionModelsQuickPanelManager'
import { useMentionModelsPanel } from './components/useMentionModelsPanel'

/**
 * Mention Models Tool
 *
 * Allows users to mention multiple AI models in their messages.
 * Uses @ trigger to open model selection panel.
 */
const mentionModelsTool = defineTool({
  key: 'mention_models',
  label: (t) => t('assistants.presets.edit.model.select.title'),

  visibleInScopes: [TopicType.Chat, 'mini-window'],
  dependencies: {
    state: ['mentionedModels', 'files', 'couldMentionNotVisionModel', 'defaultMentionsEnabled'] as const,
    actions: ['setMentionedModels', 'onTextChange', 'toggleDefaultMentions'] as const
  },

  render: function MentionModelsToolRender(context) {
    const { state, actions, assistant, quickPanel, quickPanelController } = context
    const { defaultMentionsEnabled, mentionedModels, files, couldMentionNotVisionModel } = state
    const { toggleDefaultMentions, setMentionedModels, onTextChange } = actions

    const { handleOpenQuickPanel } = useMentionModelsPanel(
      {
        quickPanel,
        quickPanelController,
        assistantId: assistant.id,
        mentionedModels: mentionedModels as Model[],
        setMentionedModels: setMentionedModels as React.Dispatch<React.SetStateAction<Model[]>>,
        couldMentionNotVisionModel,
        files: files as FileType[],
        setText: onTextChange as React.Dispatch<React.SetStateAction<string>>
      },
      'button'
    )

    return (
      <MentionModelsButton
        isDefaultMentionsEnabled={defaultMentionsEnabled}
        onToggleDefaultMentions={toggleDefaultMentions}
        onOpenPicker={handleOpenQuickPanel}
      />
    )
  },
  quickPanelManager: MentionModelsQuickPanelManager
})

registerTool(mentionModelsTool)

export default mentionModelsTool
