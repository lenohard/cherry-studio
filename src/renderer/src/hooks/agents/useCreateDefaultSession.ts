import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import { useAppDispatch } from '@renderer/store'
import { setActiveSessionIdAction, setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import type { CreateSessionForm } from '@renderer/types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Returns a stable callback that creates a default agent session and updates UI state.
 */
export const useCreateDefaultSession = (agentId: string | null) => {
  const { agent } = useAgent(agentId)
  const { createSession } = useSessions(agentId)
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const [creatingSession, setCreatingSession] = useState(false)

  const createDefaultSession = useCallback(async () => {
    if (!agentId || !agent || creatingSession) {
      return null
    }

    setCreatingSession(true)
    try {
      const session = {
        ...agent,
        id: undefined,
        name: t('common.unnamed')
      } satisfies CreateSessionForm

      const created = await createSession(session)

      if (created) {
        dispatch(setActiveSessionIdAction({ agentId, sessionId: created.id }))
        dispatch(setActiveTopicOrSessionAction('session'))
      }

      return created
    } finally {
      setCreatingSession(false)
    }
  }, [agentId, agent, createSession, creatingSession, dispatch, t])

  return useMemo(
    () => ({
      createDefaultSession,
      creatingSession
    }),
    [createDefaultSession, creatingSession]
  )
}
