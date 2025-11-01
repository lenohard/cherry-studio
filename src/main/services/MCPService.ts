import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { createInMemoryMCPServer } from '@main/mcpServers/factory'
import { makeSureDirExists, removeEnvProxy } from '@main/utils'
import { buildFunctionCallToolName } from '@main/utils/mcp'
import { getBinaryName, getBinaryPath } from '@main/utils/process'
import getLoginShellEnvironment from '@main/utils/shell-env'
import { TraceMethod, withSpanFunc } from '@mcp-trace/trace-core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions
} from '@modelcontextprotocol/sdk/client/streamableHttp'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory'
import { McpError, type Tool as SDKTool } from '@modelcontextprotocol/sdk/types'
// Import notification schemas from MCP SDK
import {
  CancelledNotificationSchema,
  type GetPromptResult,
  LoggingMessageNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js'
import { nanoid } from '@reduxjs/toolkit'
import type { MCPProgressEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { defaultAppHeaders } from '@shared/utils'
import {
  BuiltinMCPServerNames,
  type GetResourceResponse,
  isBuiltinMCPServer,
  type MCPCallToolResponse,
  type MCPPrompt,
  type MCPResource,
  type MCPServer,
  type MCPTool
} from '@types'
import { app, net } from 'electron'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'

import { CacheService } from './CacheService'
import DxtService from './DxtService'
import { CallBackServer } from './mcp/oauth/callback'
import { McpOAuthClientProvider } from './mcp/oauth/provider'
import { windowService } from './WindowService'

// Generic type for caching wrapped functions
type CachedFunction<T extends unknown[], R> = (...args: T) => Promise<R>

type CallToolArgs = { server: MCPServer; name: string; args: any; callId?: string }

const logger = loggerService.withContext('MCPService')

// Redact potentially sensitive fields in objects (headers, tokens, api keys)
function redactSensitive(input: any): any {
  const SENSITIVE_KEYS = ['authorization', 'Authorization', 'apiKey', 'api_key', 'apikey', 'token', 'access_token']
  const MAX_STRING = 300

  const redact = (val: any): any => {
    if (val == null) return val
    if (typeof val === 'string') {
      return val.length > MAX_STRING ? `${val.slice(0, MAX_STRING)}…<${val.length - MAX_STRING} more>` : val
    }
    if (Array.isArray(val)) return val.map((v) => redact(v))
    if (typeof val === 'object') {
      const out: Record<string, any> = {}
      for (const [k, v] of Object.entries(val)) {
        if (SENSITIVE_KEYS.includes(k)) {
          out[k] = '<redacted>'
        } else {
          out[k] = redact(v)
        }
      }
      return out
    }
    return val
  }

  return redact(input)
}

// Create a context-aware logger for a server
function getServerLogger(server: MCPServer, extra?: Record<string, any>) {
  const base = {
    serverName: server?.name,
    serverId: server?.id,
    baseUrl: server?.baseUrl,
    type: server?.type || (server?.command ? 'stdio' : server?.baseUrl ? 'http' : 'inmemory')
  }
  return loggerService.withContext('MCPService', { ...base, ...extra })
}

/**
 * Higher-order function to add caching capability to any async function
 * @param fn The original function to be wrapped with caching
 * @param getCacheKey Function to generate a cache key from the function arguments
 * @param ttl Time to live for the cache entry in milliseconds
 * @param logPrefix Prefix for log messages
 * @returns The wrapped function with caching capability
 */
function withCache<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  getCacheKey: (...args: T) => string,
  ttl: number,
  logPrefix: string
): CachedFunction<T, R> {
  return async (...args: T): Promise<R> => {
    const cacheKey = getCacheKey(...args)

    if (CacheService.has(cacheKey)) {
      logger.debug(`${logPrefix} loaded from cache`, { cacheKey })
      const cachedData = CacheService.get<R>(cacheKey)
      if (cachedData) {
        return cachedData
      }
    }

    const start = Date.now()
    const result = await fn(...args)
    CacheService.set(cacheKey, result, ttl)
    logger.debug(`${logPrefix} cached`, { cacheKey, ttlMs: ttl, durationMs: Date.now() - start })
    return result
  }
}

class McpService {
  private clients: Map<string, Client> = new Map()
  private pendingClients: Map<string, Promise<Client>> = new Map()
  private dxtService = new DxtService()
  private activeToolCalls: Map<string, AbortController> = new Map()

  constructor() {
    this.initClient = this.initClient.bind(this)
    this.listTools = this.listTools.bind(this)
    this.callTool = this.callTool.bind(this)
    this.listPrompts = this.listPrompts.bind(this)
    this.getPrompt = this.getPrompt.bind(this)
    this.listResources = this.listResources.bind(this)
    this.getResource = this.getResource.bind(this)
    this.closeClient = this.closeClient.bind(this)
    this.removeServer = this.removeServer.bind(this)
    this.restartServer = this.restartServer.bind(this)
    this.stopServer = this.stopServer.bind(this)
    this.abortTool = this.abortTool.bind(this)
    this.cleanup = this.cleanup.bind(this)
    this.checkMcpConnectivity = this.checkMcpConnectivity.bind(this)
    this.getServerVersion = this.getServerVersion.bind(this)
  }

  private getServerKey(server: MCPServer): string {
    return JSON.stringify({
      baseUrl: server.baseUrl,
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      registryUrl: server.registryUrl,
      env: server.env,
      id: server.id
    })
  }

  async initClient(server: MCPServer): Promise<Client> {
    const serverKey = this.getServerKey(server)

    // If there's a pending initialization, wait for it
    const pendingClient = this.pendingClients.get(serverKey)
    if (pendingClient) {
      getServerLogger(server).silly(`Waiting for pending client initialization`)
      return pendingClient
    }

    // Check if we already have a client for this server configuration
    const existingClient = this.clients.get(serverKey)
    if (existingClient) {
      try {
        // Check if the existing client is still connected
        const pingResult = await existingClient.ping({
          // add short timeout to prevent hanging
          timeout: 1000
        })
        getServerLogger(server).debug(`Ping result`, { ok: !!pingResult })
        // If the ping fails, remove the client from the cache
        // and create a new one
        if (!pingResult) {
          this.clients.delete(serverKey)
        } else {
          return existingClient
        }
      } catch (error: any) {
        getServerLogger(server).error(`Error pinging server ${server.name}`, error as Error)
        this.clients.delete(serverKey)
      }
    }

    const prepareHeaders = () => {
      return {
        ...defaultAppHeaders(),
        ...server.headers
      }
    }

    // Create a promise for the initialization process
    const initPromise = (async () => {
      try {
        // Create new client instance for each connection
        const client = new Client({ name: 'Cherry Studio', version: app.getVersion() }, { capabilities: {} })

        let args = [...(server.args || [])]

        // let transport: StdioClientTransport | SSEClientTransport | InMemoryTransport | StreamableHTTPClientTransport
        const authProvider = new McpOAuthClientProvider({
          serverUrlHash: crypto
            .createHash('md5')
            .update(server.baseUrl || '')
            .digest('hex')
        })

        const initTransport = async (): Promise<
          StdioClientTransport | SSEClientTransport | InMemoryTransport | StreamableHTTPClientTransport
        > => {
          // Create appropriate transport based on configuration
          if (isBuiltinMCPServer(server) && server.name !== BuiltinMCPServerNames.mcpAutoInstall) {
            getServerLogger(server).debug(`Using in-memory transport`)
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
            // start the in-memory server with the given name and environment variables
            const inMemoryServer = createInMemoryMCPServer(server.name, args, server.env || {})
            try {
              await inMemoryServer.connect(serverTransport)
              getServerLogger(server).debug(`In-memory server started`)
            } catch (error: any) {
              getServerLogger(server).error(`Error starting in-memory server`, error as Error)
              throw new Error(`Failed to start in-memory server: ${error.message}`)
            }
            // set the client transport to the client
            return clientTransport
          } else if (server.baseUrl) {
            if (server.type === 'streamableHttp') {
              const options: StreamableHTTPClientTransportOptions = {
                fetch: async (url, init) => {
                  return net.fetch(typeof url === 'string' ? url : url.toString(), init)
                },
                requestInit: {
                  headers: prepareHeaders()
                },
                authProvider
              }
              // redact headers before logging
              getServerLogger(server).debug(`StreamableHTTPClientTransport options`, {
                options: redactSensitive(options)
              })
              return new StreamableHTTPClientTransport(new URL(server.baseUrl!), options)
            } else if (server.type === 'sse') {
              const options: SSEClientTransportOptions = {
                eventSourceInit: {
                  fetch: async (url, init) => {
                    return net.fetch(typeof url === 'string' ? url : url.toString(), init)
                  }
                },
                requestInit: {
                  headers: prepareHeaders()
                },
                authProvider
              }
              return new SSEClientTransport(new URL(server.baseUrl!), options)
            } else {
              throw new Error('Invalid server type')
            }
          } else if (server.command) {
            let cmd = server.command

            // For DXT servers, use resolved configuration with platform overrides and variable substitution
            if (server.dxtPath) {
              const resolvedConfig = this.dxtService.getResolvedMcpConfig(server.dxtPath)
              if (resolvedConfig) {
                cmd = resolvedConfig.command
                args = resolvedConfig.args
                // Merge resolved environment variables with existing ones
                server.env = {
                  ...server.env,
                  ...resolvedConfig.env
                }
                getServerLogger(server).debug(`Using resolved DXT config`, {
                  command: cmd,
                  args
                })
              } else {
                getServerLogger(server).warn(`Failed to resolve DXT config, falling back to manifest values`)
              }
            }

            if (server.command === 'npx') {
              cmd = await getBinaryPath('bun')
              getServerLogger(server).debug(`Using command`, { command: cmd })

              // add -x to args if args exist
              if (args && args.length > 0) {
                if (!args.includes('-y')) {
                  args.unshift('-y')
                }
                if (!args.includes('x')) {
                  args.unshift('x')
                }
              }
              if (server.registryUrl) {
                server.env = {
                  ...server.env,
                  NPM_CONFIG_REGISTRY: server.registryUrl
                }

                // if the server name is mcp-auto-install, use the mcp-registry.json file in the bin directory
                if (server.name.includes('mcp-auto-install')) {
                  const binPath = await getBinaryPath()
                  makeSureDirExists(binPath)
                  server.env.MCP_REGISTRY_PATH = path.join(binPath, '..', 'config', 'mcp-registry.json')
                }
              }
            } else if (server.command === 'uvx' || server.command === 'uv') {
              cmd = await getBinaryPath(server.command)
              if (server.registryUrl) {
                server.env = {
                  ...server.env,
                  UV_DEFAULT_INDEX: server.registryUrl,
                  PIP_INDEX_URL: server.registryUrl
                }
              }
            }

            getServerLogger(server).debug(`Starting server`, { command: cmd, args })
            // Logger.info(`[MCP] Environment variables for server:`, server.env)
            const loginShellEnv = await getLoginShellEnvironment()

            // Bun not support proxy https://github.com/oven-sh/bun/issues/16812
            if (cmd.includes('bun')) {
              removeEnvProxy(loginShellEnv)
            }

            const transportOptions: any = {
              command: cmd,
              args,
              env: {
                ...loginShellEnv,
                ...server.env
              },
              stderr: 'pipe'
            }

            // For DXT servers, set the working directory to the extracted path
            if (server.dxtPath) {
              transportOptions.cwd = server.dxtPath
              getServerLogger(server).debug(`Setting working directory for DXT server`, {
                cwd: server.dxtPath
              })
            }

            const stdioTransport = new StdioClientTransport(transportOptions)
            stdioTransport.stderr?.on('data', (data) =>
              getServerLogger(server).debug(`Stdio stderr`, { data: data.toString() })
            )
            return stdioTransport
          } else {
            throw new Error('Either baseUrl or command must be provided')
          }
        }

        const handleAuth = async (client: Client, transport: SSEClientTransport | StreamableHTTPClientTransport) => {
          getServerLogger(server).debug(`Starting OAuth flow`)
          // Create an event emitter for the OAuth callback
          const events = new EventEmitter()

          // Create a callback server
          const callbackServer = new CallBackServer({
            port: authProvider.config.callbackPort,
            path: authProvider.config.callbackPath || '/oauth/callback',
            events
          })

          // Set a timeout to close the callback server
          const timeoutId = setTimeout(() => {
            getServerLogger(server).warn(`OAuth flow timed out`)
            callbackServer.close()
          }, 300000) // 5 minutes timeout

          try {
            // Wait for the authorization code
            const authCode = await callbackServer.waitForAuthCode()
            getServerLogger(server).debug(`Received auth code`)

            // Complete the OAuth flow
            await transport.finishAuth(authCode)

            getServerLogger(server).debug(`OAuth flow completed`)

            const newTransport = await initTransport()
            // Try to connect again
            await client.connect(newTransport)

            getServerLogger(server).debug(`Successfully authenticated`)
          } catch (oauthError) {
            getServerLogger(server).error(`OAuth authentication failed`, oauthError as Error)
            throw new Error(
              `OAuth authentication failed: ${oauthError instanceof Error ? oauthError.message : String(oauthError)}`
            )
          } finally {
            // Clear the timeout and close the callback server
            clearTimeout(timeoutId)
            callbackServer.close()
          }
        }

        try {
          const transport = await initTransport()
          try {
            await client.connect(transport)
          } catch (error: any) {
            if (
              error instanceof Error &&
              (error.name === 'UnauthorizedError' || error.message.includes('Unauthorized'))
            ) {
              logger.debug(`Authentication required for server: ${server.name}`)
              await handleAuth(client, transport as SSEClientTransport | StreamableHTTPClientTransport)
            } else {
              throw error
            }
          }

          // Store the new client in the cache
          this.clients.set(serverKey, client)

          // Set up notification handlers
          this.setupNotificationHandlers(client, server)

          // Clear existing cache to ensure fresh data
          this.clearServerCache(serverKey)

          logger.debug(`Activated server: ${server.name}`)
          return client
        } catch (error) {
          getServerLogger(server).error(`Error activating server ${server.name}`, error as Error)
          throw error
        }
      } finally {
        // Clean up the pending promise when done
        this.pendingClients.delete(serverKey)
      }
    })()

    // Store the pending promise
    this.pendingClients.set(serverKey, initPromise)

    return initPromise
  }

  /**
   * Set up notification handlers for MCP client
   */
  private setupNotificationHandlers(client: Client, server: MCPServer) {
    const serverKey = this.getServerKey(server)

    try {
      // Set up tools list changed notification handler
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        logger.debug(`Tools list changed for server: ${server.name}`)
        // Clear tools cache
        CacheService.remove(`mcp:list_tool:${serverKey}`)
      })

      // Set up resources list changed notification handler
      client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
        logger.debug(`Resources list changed for server: ${server.name}`)
        // Clear resources cache
        CacheService.remove(`mcp:list_resources:${serverKey}`)
      })

      // Set up prompts list changed notification handler
      client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
        logger.debug(`Prompts list changed for server: ${server.name}`)
        // Clear prompts cache
        CacheService.remove(`mcp:list_prompts:${serverKey}`)
      })

      // Set up resource updated notification handler
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, async () => {
        logger.debug(`Resource updated for server: ${server.name}`)
        // Clear resource-specific caches
        this.clearResourceCaches(serverKey)
      })

      // Set up cancelled notification handler
      client.setNotificationHandler(CancelledNotificationSchema, async (notification) => {
        logger.debug(`Operation cancelled for server: ${server.name}`, notification.params)
      })

      // Set up logging message notification handler
      client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
        logger.debug(`Message from server ${server.name}:`, notification.params)
      })

      getServerLogger(server).debug(`Set up notification handlers`)
    } catch (error) {
      getServerLogger(server).error(`Failed to set up notification handlers`, error as Error)
    }
  }

  /**
   * Clear resource-specific caches for a server
   */
  private clearResourceCaches(serverKey: string) {
    CacheService.remove(`mcp:list_resources:${serverKey}`)
  }

  /**
   * Clear all caches for a specific server
   */
  private clearServerCache(serverKey: string) {
    CacheService.remove(`mcp:list_tool:${serverKey}`)
    CacheService.remove(`mcp:list_prompts:${serverKey}`)
    CacheService.remove(`mcp:list_resources:${serverKey}`)
    logger.debug(`Cleared all caches for server`, { serverKey })
  }

  async closeClient(serverKey: string) {
    const client = this.clients.get(serverKey)
    if (client) {
      // Remove the client from the cache
      await client.close()
      logger.debug(`Closed server`, { serverKey })
      this.clients.delete(serverKey)
      // Clear all caches for this server
      this.clearServerCache(serverKey)
    } else {
      logger.warn(`No client found for server`, { serverKey })
    }
  }

  async stopServer(_: Electron.IpcMainInvokeEvent, server: MCPServer) {
    const serverKey = this.getServerKey(server)
    getServerLogger(server).debug(`Stopping server`)
    await this.closeClient(serverKey)
  }

  async removeServer(_: Electron.IpcMainInvokeEvent, server: MCPServer) {
    const serverKey = this.getServerKey(server)
    const existingClient = this.clients.get(serverKey)
    if (existingClient) {
      await this.closeClient(serverKey)
    }

    // If this is a DXT server, cleanup its directory
    if (server.dxtPath) {
      try {
        const cleaned = this.dxtService.cleanupDxtServer(server.name)
        if (cleaned) {
          getServerLogger(server).debug(`Cleaned up DXT server directory`)
        }
      } catch (error) {
        getServerLogger(server).error(`Failed to cleanup DXT server`, error as Error)
      }
    }
  }

  async restartServer(_: Electron.IpcMainInvokeEvent, server: MCPServer) {
    getServerLogger(server).debug(`Restarting server`)
    const serverKey = this.getServerKey(server)
    await this.closeClient(serverKey)
    // Clear cache before restarting to ensure fresh data
    this.clearServerCache(serverKey)
    await this.initClient(server)
  }

  async cleanup() {
    for (const [key] of this.clients) {
      try {
        await this.closeClient(key)
      } catch (error: any) {
        logger.error(`Failed to close client`, error as Error)
      }
    }
  }

  /**
   * Check connectivity for an MCP server
   */
  public async checkMcpConnectivity(_: Electron.IpcMainInvokeEvent, server: MCPServer): Promise<boolean> {
    getServerLogger(server).debug(`Checking connectivity`)
    try {
      getServerLogger(server).debug(`About to call initClient`, { hasInitClient: !!this.initClient })

      if (!this.initClient) {
        throw new Error('initClient method is not available')
      }

      const client = await this.initClient(server)
      // Attempt to list tools as a way to check connectivity
      await client.listTools()
      getServerLogger(server).debug(`Connectivity check successful`)
      return true
    } catch (error) {
      getServerLogger(server).error(`Connectivity check failed`, error as Error)
      // Close the client if connectivity check fails to ensure a clean state for the next attempt
      const serverKey = this.getServerKey(server)
      await this.closeClient(serverKey)
      return false
    }
  }

  private async listToolsImpl(server: MCPServer): Promise<MCPTool[]> {
    const client = await this.initClient(server)
    try {
      const { tools } = await client.listTools()
      const serverTools: MCPTool[] = []
      tools.map((tool: SDKTool) => {
        const serverTool: MCPTool = {
          ...tool,
          id: buildFunctionCallToolName(server.name, tool.name),
          serverId: server.id,
          serverName: server.name,
          type: 'mcp'
        }
        serverTools.push(serverTool)
        getServerLogger(server).debug(`Listing tools`, { tool: serverTool })
      })
      return serverTools
    } catch (error: unknown) {
      getServerLogger(server).error(`Failed to list tools`, error as Error)
      throw error
    }
  }

  async listTools(_: Electron.IpcMainInvokeEvent, server: MCPServer) {
    const listFunc = (server: MCPServer) => {
      const cachedListTools = withCache<[MCPServer], MCPTool[]>(
        this.listToolsImpl.bind(this),
        (server) => {
          const serverKey = this.getServerKey(server)
          return `mcp:list_tool:${serverKey}`
        },
        5 * 60 * 1000, // 5 minutes TTL
        `[MCP] Tools from ${server.name}`
      )

      const result = cachedListTools(server)
      return result
    }

    return withSpanFunc(`${server.name}.ListTool`, 'MCP', listFunc, [server])
  }

  /**
   * Call a tool on an MCP server
   */
  public async callTool(
    _: Electron.IpcMainInvokeEvent,
    { server, name, args, callId }: CallToolArgs
  ): Promise<MCPCallToolResponse> {
    const toolCallId = callId || uuidv4()
    const abortController = new AbortController()
    this.activeToolCalls.set(toolCallId, abortController)

    const callToolFunc = async ({ server, name, args }: CallToolArgs) => {
      try {
        getServerLogger(server, { tool: name, callId: toolCallId }).debug(`Calling tool`, {
          args: redactSensitive(args)
        })
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args)
          } catch (e) {
            getServerLogger(server, { tool: name, callId: toolCallId }).error('args parse error', e as Error, {
              args
            })
          }
          if (args === '') {
            args = {}
          }
        }
        const client = await this.initClient(server)
        const result = await client.callTool({ name, arguments: args }, undefined, {
          onprogress: (process) => {
            getServerLogger(server, { tool: name, callId: toolCallId }).debug(`Progress`, {
              ratio: process.progress / (process.total || 1)
            })
            const mainWindow = windowService.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send(IpcChannel.Mcp_Progress, {
                callId: toolCallId,
                progress: process.progress / (process.total || 1)
              } as MCPProgressEvent)
            }
          },
          timeout: server.timeout ? server.timeout * 1000 : 60000, // Default timeout of 1 minute,
          // 需要服务端支持: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#timeouts
          // Need server side support: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#timeouts
          resetTimeoutOnProgress: server.longRunning,
          maxTotalTimeout: server.longRunning ? 10 * 60 * 1000 : undefined,
          signal: this.activeToolCalls.get(toolCallId)?.signal
        })
        return result as MCPCallToolResponse
      } catch (error) {
        getServerLogger(server, { tool: name, callId: toolCallId }).error(`Error calling tool`, error as Error)
        throw error
      } finally {
        this.activeToolCalls.delete(toolCallId)
      }
    }

    return await withSpanFunc(`${server.name}.${name}`, `MCP`, callToolFunc, [{ server, name, args }])
  }

  public async getInstallInfo() {
    const dir = path.join(os.homedir(), '.cherrystudio', 'bin')
    const uvName = await getBinaryName('uv')
    const bunName = await getBinaryName('bun')
    const uvPath = path.join(dir, uvName)
    const bunPath = path.join(dir, bunName)
    return { dir, uvPath, bunPath }
  }

  /**
   * List prompts available on an MCP server
   */
  private async listPromptsImpl(server: MCPServer): Promise<MCPPrompt[]> {
    const client = await this.initClient(server)
    getServerLogger(server).debug(`Listing prompts`)
    try {
      const { prompts } = await client.listPrompts()
      return prompts.map((prompt: any) => ({
        ...prompt,
        id: `p${nanoid()}`,
        serverId: server.id,
        serverName: server.name
      }))
    } catch (error: unknown) {
      // -32601 is the code for the method not found
      if (error instanceof McpError && error.code !== -32601) {
        getServerLogger(server).error(`Failed to list prompts`, error as Error)
      }
      return []
    }
  }

  /**
   * List prompts available on an MCP server with caching
   */
  public async listPrompts(_: Electron.IpcMainInvokeEvent, server: MCPServer): Promise<MCPPrompt[]> {
    const cachedListPrompts = withCache<[MCPServer], MCPPrompt[]>(
      this.listPromptsImpl.bind(this),
      (server) => {
        const serverKey = this.getServerKey(server)
        return `mcp:list_prompts:${serverKey}`
      },
      60 * 60 * 1000, // 60 minutes TTL
      `[MCP] Prompts from ${server.name}`
    )
    return cachedListPrompts(server)
  }

  /**
   * Get a specific prompt from an MCP server (implementation)
   */
  private async getPromptImpl(server: MCPServer, name: string, args?: Record<string, any>): Promise<GetPromptResult> {
    logger.debug(`Getting prompt ${name} from server: ${server.name}`)
    const client = await this.initClient(server)
    return await client.getPrompt({ name, arguments: args })
  }

  /**
   * Get a specific prompt from an MCP server with caching
   */
  @TraceMethod({ spanName: 'getPrompt', tag: 'mcp' })
  public async getPrompt(
    _: Electron.IpcMainInvokeEvent,
    { server, name, args }: { server: MCPServer; name: string; args?: Record<string, any> }
  ): Promise<GetPromptResult> {
    const cachedGetPrompt = withCache<[MCPServer, string, Record<string, any> | undefined], GetPromptResult>(
      this.getPromptImpl.bind(this),
      (server, name, args) => {
        const serverKey = this.getServerKey(server)
        const argsKey = args ? JSON.stringify(args) : 'no-args'
        return `mcp:get_prompt:${serverKey}:${name}:${argsKey}`
      },
      30 * 60 * 1000, // 30 minutes TTL
      `[MCP] Prompt ${name} from ${server.name}`
    )
    return await cachedGetPrompt(server, name, args)
  }

  /**
   * List resources available on an MCP server (implementation)
   */
  private async listResourcesImpl(server: MCPServer): Promise<MCPResource[]> {
    const client = await this.initClient(server)
    logger.debug(`Listing resources for server: ${server.name}`)
    try {
      const result = await client.listResources()
      const resources = result.resources || []
      return (Array.isArray(resources) ? resources : []).map((resource: any) => ({
        ...resource,
        serverId: server.id,
        serverName: server.name
      }))
    } catch (error: any) {
      // -32601 is the code for the method not found
      if (error?.code !== -32601) {
        getServerLogger(server).error(`Failed to list resources`, error as Error)
      }
      return []
    }
  }

  /**
   * List resources available on an MCP server with caching
   */
  public async listResources(_: Electron.IpcMainInvokeEvent, server: MCPServer): Promise<MCPResource[]> {
    const cachedListResources = withCache<[MCPServer], MCPResource[]>(
      this.listResourcesImpl.bind(this),
      (server) => {
        const serverKey = this.getServerKey(server)
        return `mcp:list_resources:${serverKey}`
      },
      60 * 60 * 1000, // 60 minutes TTL
      `[MCP] Resources from ${server.name}`
    )
    return cachedListResources(server)
  }

  /**
   * Get a specific resource from an MCP server (implementation)
   */
  private async getResourceImpl(server: MCPServer, uri: string): Promise<GetResourceResponse> {
    getServerLogger(server, { uri }).debug(`Getting resource`)
    const client = await this.initClient(server)
    try {
      const result = await client.readResource({ uri: uri })
      const contents: MCPResource[] = []
      if (result.contents && result.contents.length > 0) {
        result.contents.forEach((content: any) => {
          contents.push({
            ...content,
            serverId: server.id,
            serverName: server.name
          })
        })
      }
      return {
        contents: contents
      }
    } catch (error: any) {
      getServerLogger(server, { uri }).error(`Failed to get resource`, error as Error)
      throw new Error(`Failed to get resource ${uri} from server: ${server.name}: ${error.message}`)
    }
  }

  /**
   * Get a specific resource from an MCP server with caching
   */
  @TraceMethod({ spanName: 'getResource', tag: 'mcp' })
  public async getResource(
    _: Electron.IpcMainInvokeEvent,
    { server, uri }: { server: MCPServer; uri: string }
  ): Promise<GetResourceResponse> {
    const cachedGetResource = withCache<[MCPServer, string], GetResourceResponse>(
      this.getResourceImpl.bind(this),
      (server, uri) => {
        const serverKey = this.getServerKey(server)
        return `mcp:get_resource:${serverKey}:${uri}`
      },
      30 * 60 * 1000, // 30 minutes TTL
      `[MCP] Resource ${uri} from ${server.name}`
    )
    return await cachedGetResource(server, uri)
  }

  // 实现 abortTool 方法
  public async abortTool(_: Electron.IpcMainInvokeEvent, callId: string) {
    const activeToolCall = this.activeToolCalls.get(callId)
    if (activeToolCall) {
      activeToolCall.abort()
      this.activeToolCalls.delete(callId)
      logger.debug(`Aborted tool call`, { callId })
      return true
    } else {
      logger.warn(`No active tool call found for callId`, { callId })
      return false
    }
  }

  /**
   * Get the server version information
   */
  public async getServerVersion(_: Electron.IpcMainInvokeEvent, server: MCPServer): Promise<string | null> {
    try {
      getServerLogger(server).debug(`Getting server version`)
      const client = await this.initClient(server)

      // Try to get server information which may include version
      const serverInfo = client.getServerVersion()
      getServerLogger(server).debug(`Server info`, redactSensitive(serverInfo))

      if (serverInfo && serverInfo.version) {
        getServerLogger(server).debug(`Server version`, { version: serverInfo.version })
        return serverInfo.version
      }

      getServerLogger(server).warn(`No version information available`)
      return null
    } catch (error: any) {
      getServerLogger(server).error(`Failed to get server version`, error as Error)
      return null
    }
  }
}

export default new McpService()
