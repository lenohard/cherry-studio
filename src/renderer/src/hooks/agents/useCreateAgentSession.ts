import { useAppDispatch } from '@renderer/store'
import { setActiveSessionIdAction, setActiveTopicOrSessionAction } from '@renderer/store/runtime'
import type { CreateAgentSessionResponse, CreateSessionForm, GetAgentResponse } from '@renderer/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type CreateSessionFn = (form: CreateSessionForm) => Promise<CreateAgentSessionResponse | null>

/**
 * Returns a stable callback that creates a new agent session and updates UI state.
 */
export const useCreateAgentSession = (
  agentId: string | null,
  agent: GetAgentResponse | undefined,
  createSession?: CreateSessionFn
) => {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  return useCallback(async () => {
    if (!agentId || !agent || !createSession) {
      return null
    }

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
  }, [agentId, agent, createSession, dispatch, t])
}
