import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'

import MentionModelsButton from './components/MentionModelsButton'
import MentionModelsQuickPanelManager from './components/MentionModelsQuickPanelManager'

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
    const { state, actions } = context
    const { defaultMentionsEnabled } = state
    const { toggleDefaultMentions } = actions

    return (
      <MentionModelsButton
        isDefaultMentionsEnabled={defaultMentionsEnabled}
        onToggleDefaultMentions={toggleDefaultMentions}
      />
    )
  },
  quickPanelManager: MentionModelsQuickPanelManager
})

registerTool(mentionModelsTool)

export default mentionModelsTool
