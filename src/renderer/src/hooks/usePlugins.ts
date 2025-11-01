import type { InstalledPlugin, PluginError, PluginMetadata } from '@renderer/types/plugin'
import { useCallback, useEffect, useState } from 'react'

/**
 * Helper to extract error message from PluginError union type
 */
function getPluginErrorMessage(error: PluginError, defaultMessage: string): string {
  if ('message' in error && error.message) return error.message
  if ('reason' in error) return error.reason
  if ('path' in error) return `Error with file: ${error.path}`
  return defaultMessage
}

/**
 * Hook to fetch and cache available plugins from the resources directory
 * @returns Object containing available agents, commands, skills, loading state, and error
 */
export function useAvailablePlugins() {
  const [agents, setAgents] = useState<PluginMetadata[]>([])
  const [commands, setCommands] = useState<PluginMetadata[]>([])
  const [skills, setSkills] = useState<PluginMetadata[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchAvailablePlugins = async () => {
      setLoading(true)
      setError(null)

      try {
        const result = await window.api.claudeCodePlugin.listAvailable()

        if (result.success) {
          setAgents(result.data.agents)
          setCommands(result.data.commands)
          setSkills(result.data.skills)
        } else {
          setError(getPluginErrorMessage(result.error, 'Failed to load available plugins'))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchAvailablePlugins()
  }, [])

  return { agents, commands, skills, loading, error }
}

/**
 * Hook to fetch installed plugins for a specific agent
 * @param agentId - The ID of the agent to fetch plugins for
 * @returns Object containing installed plugins, loading state, error, and refresh function
 */
export function useInstalledPlugins(agentId: string | undefined) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!agentId) {
      setPlugins([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await window.api.claudeCodePlugin.listInstalled(agentId)

      if (result.success) {
        setPlugins(result.data)
      } else {
        setError(getPluginErrorMessage(result.error, 'Failed to load installed plugins'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { plugins, loading, error, refresh }
}

/**
 * Hook to provide install and uninstall actions for plugins
 * @param agentId - The ID of the agent to perform actions for
 * @param onSuccess - Optional callback to be called on successful operations
 * @returns Object containing install, uninstall functions and their loading states
 */
export function usePluginActions(agentId: string, onSuccess?: () => void) {
  const [installing, setInstalling] = useState<boolean>(false)
  const [uninstalling, setUninstalling] = useState<boolean>(false)

  const install = useCallback(
    async (sourcePath: string, type: 'agent' | 'command' | 'skill') => {
      setInstalling(true)

      try {
        const result = await window.api.claudeCodePlugin.install({
          agentId,
          sourcePath,
          type
        })

        if (result.success) {
          onSuccess?.()
          return { success: true as const, data: result.data }
        } else {
          const errorMessage = getPluginErrorMessage(result.error, 'Failed to install plugin')
          return { success: false as const, error: errorMessage }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
        return { success: false as const, error: errorMessage }
      } finally {
        setInstalling(false)
      }
    },
    [agentId, onSuccess]
  )

  const uninstall = useCallback(
    async (filename: string, type: 'agent' | 'command' | 'skill') => {
      setUninstalling(true)

      try {
        const result = await window.api.claudeCodePlugin.uninstall({
          agentId,
          filename,
          type
        })

        if (result.success) {
          onSuccess?.()
          return { success: true as const }
        } else {
          const errorMessage = getPluginErrorMessage(result.error, 'Failed to uninstall plugin')
          return { success: false as const, error: errorMessage }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
        return { success: false as const, error: errorMessage }
      } finally {
        setUninstalling(false)
      }
    },
    [agentId, onSuccess]
  )

  return { install, uninstall, installing, uninstalling }
}
