import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

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
    state: [] as const,
    actions: ['setMentionedModels'] as const
  },

  render: function MentionModelsToolRender(context) {
    const { actions, assistant, topic } = context
    const { setMentionedModels } = actions

    return <MentionModelsButton setMentionedModels={setMentionedModels} assistant={assistant} topic={topic} />
  },
  quickPanelManager: MentionModelsQuickPanelManager
})

registerTool(mentionModelsTool)

export default mentionModelsTool
