import { ActionIconButton } from '@renderer/components/Buttons'
import { Tooltip } from 'antd'
import { AtSign } from 'lucide-react'
import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  isDefaultMentionsEnabled: boolean
  onToggleDefaultMentions: () => void
}

const MentionModelsButton: FC<Props> = ({ isDefaultMentionsEnabled, onToggleDefaultMentions }) => {
  const { t } = useTranslation()
  const tooltipKey = isDefaultMentionsEnabled
    ? t('assistants.settings.default_models.enabled')
    : t('assistants.settings.default_models.disabled')

  return (
    <Tooltip placement="top" title={tooltipKey} mouseLeaveDelay={0} arrow>
      <ActionIconButton onClick={onToggleDefaultMentions} active={isDefaultMentionsEnabled}>
        <AtSign size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(MentionModelsButton)
