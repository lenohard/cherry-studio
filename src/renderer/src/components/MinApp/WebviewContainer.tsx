import { loggerService } from '@logger'
import { useSettings } from '@renderer/hooks/useSettings'
import type { WebviewTag } from 'electron'
import { memo, useEffect, useRef } from 'react'

const logger = loggerService.withContext('WebviewContainer')

/**
 * WebviewContainer is a component that renders a webview element.
 * It is used in the MinAppPopupContainer component.
 * The webcontent can be remain in memory
 */
const WebviewContainer = memo(
  ({
    appid,
    url,
    onSetRefCallback,
    onLoadedCallback,
    onNavigateCallback
  }: {
    appid: string
    url: string
    onSetRefCallback: (appid: string, element: WebviewTag | null) => void
    onLoadedCallback: (appid: string) => void
    onNavigateCallback: (appid: string, url: string) => void
  }) => {
    const webviewRef = useRef<WebviewTag | null>(null)
    const { enableSpellCheck, minappsOpenLinkExternal } = useSettings()

    const setRef = (appid: string) => {
      onSetRefCallback(appid, null)

      return (element: WebviewTag | null) => {
        onSetRefCallback(appid, element)
        if (element) {
          webviewRef.current = element
        } else {
          webviewRef.current = null
        }
      }
    }

    useEffect(() => {
      if (!webviewRef.current) return

      let loadCallbackFired = false

      const handleLoaded = () => {
        logger.debug(`WebView did-finish-load for app: ${appid}`)
        // Only fire callback once per load cycle
        if (!loadCallbackFired) {
          loadCallbackFired = true
          // Small delay to ensure content is actually visible
          setTimeout(() => {
            logger.debug(`Calling onLoadedCallback for app: ${appid}`)
            onLoadedCallback(appid)
          }, 100)
        }
      }

      // Additional callback for when page is ready to show
      const handleReadyToShow = () => {
        logger.debug(`WebView ready-to-show for app: ${appid}`)
        if (!loadCallbackFired) {
          loadCallbackFired = true
          logger.debug(`Calling onLoadedCallback from ready-to-show for app: ${appid}`)
          onLoadedCallback(appid)
        }
      }

      const handleNavigate = (event: any) => {
        onNavigateCallback(appid, event.url)
      }

      const handleDomReady = () => {
        const webviewId = webviewRef.current?.getWebContentsId()
        if (webviewId) {
          window.api?.webview?.setSpellCheckEnabled?.(webviewId, enableSpellCheck)
          // Set link opening behavior for this webview
          window.api?.webview?.setOpenLinkExternal?.(webviewId, minappsOpenLinkExternal)
        }
      }

      const handleStartLoading = () => {
        // Reset callback flag when starting a new load
        loadCallbackFired = false
      }

      webviewRef.current.addEventListener('did-start-loading', handleStartLoading)
      webviewRef.current.addEventListener('dom-ready', handleDomReady)
      webviewRef.current.addEventListener('did-finish-load', handleLoaded)
      webviewRef.current.addEventListener('ready-to-show', handleReadyToShow)
      webviewRef.current.addEventListener('did-navigate-in-page', handleNavigate)

      // we set the url when the webview is ready
      webviewRef.current.src = url

      return () => {
        webviewRef.current?.removeEventListener('did-start-loading', handleStartLoading)
        webviewRef.current?.removeEventListener('dom-ready', handleDomReady)
        webviewRef.current?.removeEventListener('did-finish-load', handleLoaded)
        webviewRef.current?.removeEventListener('ready-to-show', handleReadyToShow)
        webviewRef.current?.removeEventListener('did-navigate-in-page', handleNavigate)
      }
      // because the appid and url are enough, no need to add onLoadedCallback
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appid, url])

    // Update webview settings when they change
    useEffect(() => {
      if (!webviewRef.current) return

      try {
        const webviewId = webviewRef.current.getWebContentsId()
        if (webviewId) {
          window.api?.webview?.setSpellCheckEnabled?.(webviewId, enableSpellCheck)
          window.api?.webview?.setOpenLinkExternal?.(webviewId, minappsOpenLinkExternal)
        }
      } catch (error) {
        // WebView may not be ready yet, settings will be applied in dom-ready event
        logger.debug(`WebView ${appid} not ready for settings update`)
      }
    }, [appid, minappsOpenLinkExternal, enableSpellCheck])

    const WebviewStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      backgroundColor: 'var(--color-background)',
      display: 'inline-flex'
    }

    return (
      <webview
        key={appid}
        ref={setRef(appid)}
        data-minapp-id={appid}
        style={WebviewStyle}
        allowpopups={'true' as any}
        partition="persist:webview"
        useragent={
          appid === 'google'
            ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)  Safari/537.36'
            : undefined
        }
      />
    )
  }
)

export default WebviewContainer
