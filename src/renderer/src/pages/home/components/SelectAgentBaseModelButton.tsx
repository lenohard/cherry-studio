import { Button } from '@heroui/react'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { SelectApiModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { agentModelFilter } from '@renderer/config/models'
import { useApiModel } from '@renderer/hooks/agents/useModel'
import { getProviderNameById } from '@renderer/services/ProviderService'
import type { AgentBaseWithId, ApiModel } from '@renderer/types'
import { isAgentEntity } from '@renderer/types'
import { getModelFilterByAgentType } from '@renderer/utils/agentSession'
import { apiModelAdapter } from '@renderer/utils/model'
import { ChevronsUpDown } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  agentBase: AgentBaseWithId
  onSelect: (model: ApiModel) => Promise<void>
  isDisabled?: boolean
}

const SelectAgentBaseModelButton: FC<Props> = ({ agentBase: agent, onSelect, isDisabled }) => {
  const { t } = useTranslation()
  const model = useApiModel({ id: agent?.model })

  const apiFilter = isAgentEntity(agent) ? getModelFilterByAgentType(agent.type) : undefined

  if (!agent) return null

  const onSelectModel = async () => {
    const selectedModel = await SelectApiModelPopup.show({ model, apiFilter: apiFilter, modelFilter: agentModelFilter })
    if (selectedModel && selectedModel.id !== agent.model) {
      onSelect(selectedModel)
    }
  }

  const providerName = model?.provider ? getProviderNameById(model.provider) : model?.provider_name

  return (
    <Button
      size="sm"
      variant="light"
      className="nodrag h-[28px] rounded-2xl px-1"
      onPress={onSelectModel}
      isDisabled={isDisabled}>
      <div className="flex items-center gap-1.5 overflow-x-hidden">
        <ModelAvatar model={model ? apiModelAdapter(model) : undefined} size={20} />
        <span className="truncate text-[var(--color-text)]">
          {model ? model.name : t('button.select_model')} {providerName ? ' | ' + providerName : ''}
        </span>
      </div>
      <ChevronsUpDown size={14} color="var(--color-icon)" />
    </Button>
  )
}

export default SelectAgentBaseModelButton
