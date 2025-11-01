import { cn, Tooltip } from '@heroui/react'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useSettings } from '@renderer/hooks/useSettings'
import AgentSettingsPopup from '@renderer/pages/settings/AgentSettings/AgentSettingsPopup'
import { AgentLabel } from '@renderer/pages/settings/AgentSettings/shared'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AgentEntity } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { Bot } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// const logger = loggerService.withContext('AgentItem')

interface AgentItemProps {
  agent: AgentEntity
  isActive: boolean
  onDelete: (agent: AgentEntity) => void
  onPress: () => void
}

const AgentItem: FC<AgentItemProps> = ({ agent, isActive, onDelete, onPress }) => {
  const { t } = useTranslation()
  const { sessions } = useSessions(agent.id)
  const { clickAssistantToShowTopic, topicPosition } = useSettings()

  const handlePress = useCallback(() => {
    // Show session sidebar if setting is enabled (reusing the assistant setting for consistency)
    if (clickAssistantToShowTopic) {
      if (topicPosition === 'left') {
        EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
      }
    }
    onPress()
  }, [clickAssistantToShowTopic, topicPosition, onPress])

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger>
        <Container onClick={handlePress} isActive={isActive}>
          <AssistantNameRow className="name" title={agent.name ?? agent.id}>
            <AgentNameWrapper>
              <AgentLabel agent={agent} />
            </AgentNameWrapper>
            {isActive && (
              <MenuButton>
                <SessionCount>{sessions.length}</SessionCount>
              </MenuButton>
            )}
            {!isActive && <BotIcon />}
          </AssistantNameRow>
        </Container>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem key="edit" onClick={() => AgentSettingsPopup.show({ agentId: agent.id })}>
          <EditIcon size={14} />
          {t('common.edit')}
        </ContextMenuItem>
        <ContextMenuItem
          key="delete"
          className="text-danger"
          onClick={() => {
            window.modal.confirm({
              title: t('agent.delete.title'),
              content: t('agent.delete.content'),
              centered: true,
              okButtonProps: { danger: true },
              onOk: () => onDelete(agent)
            })
          }}>
          <DeleteIcon size={14} className="lucide-custom text-danger" />
          <span className="text-danger">{t('common.delete')}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const Container: React.FC<{ isActive?: boolean } & React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  isActive,
  ...props
}) => (
  <div
    className={cn(
      'relative flex h-[37px] w-[calc(var(--assistants-width)-20px)] cursor-pointer flex-row justify-between rounded-[var(--list-item-border-radius)] border border-transparent px-2',
      !isActive && 'hover:bg-[var(--color-list-item-hover)]',
      isActive && 'bg-[var(--color-list-item)] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]',
      className
    )}
    {...props}
  />
)

export const AssistantNameRow: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn('flex min-w-0 flex-1 flex-row items-center gap-2 text-[13px] text-[var(--color-text)]', className)}
    {...props}
  />
)

export const AgentNameWrapper: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap', className)} {...props} />
)

export const MenuButton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'flex h-5 min-h-5 w-5 flex-row items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-background)]',
      className
    )}
    {...props}
  />
)

export const BotIcon: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ ...props }) => {
  const { t } = useTranslation()
  return (
    <Tooltip content={t('common.agent_one')} delay={500} closeDelay={0}>
      <MenuButton {...props}>
        <Bot size={14} className="text-primary" />
      </MenuButton>
    </Tooltip>
  )
}

export const SessionCount: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn('flex flex-row items-center justify-center rounded-full text-[var(--color-text)] text-xs', className)}
    {...props}
  />
)

export default memo(AgentItem)
