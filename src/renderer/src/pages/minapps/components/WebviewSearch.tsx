import { Button, Input } from '@heroui/react'
import { loggerService } from '@logger'
import type { WebviewTag } from 'electron'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type FoundInPageResult = Electron.FoundInPageResult

interface WebviewSearchProps {
  webviewRef: React.RefObject<WebviewTag | null>
  isWebviewReady: boolean
  appId: string
}

const logger = loggerService.withContext('WebviewSearch')

const WebviewSearch: FC<WebviewSearchProps> = ({ webviewRef, isWebviewReady, appId }) => {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusFrameRef = useRef<number | null>(null)
  const lastAppIdRef = useRef<string>(appId)
  const attachedWebviewRef = useRef<WebviewTag | null>(null)
  const activeWebview = webviewRef.current ?? null

  const focusInput = useCallback(() => {
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = null
    }
    focusFrameRef.current = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const resetSearchState = useCallback((options?: { keepQuery?: boolean }) => {
    if (!options?.keepQuery) {
      setQuery('')
    }
    setMatchCount(0)
    setActiveIndex(0)
  }, [])

  const ensureWebviewReady = useCallback(
    (candidate: WebviewTag | null) => {
      if (!candidate) return null
      try {
        const webContentsId = candidate.getWebContentsId?.()
        if (!webContentsId) {
          logger.debug('WebviewSearch: missing webContentsId before action', { appId })
          return null
        }
      } catch (error) {
        logger.debug('WebviewSearch: getWebContentsId failed before action', { appId, error })
        return null
      }

      return candidate
    },
    [appId]
  )

  const stopFindOnWebview = useCallback(
    (webview: WebviewTag | null) => {
      const usable = ensureWebviewReady(webview)
      if (!usable) return false
      try {
        usable.stopFindInPage('clearSelection')
        return true
      } catch (error) {
        logger.debug('stopFindInPage failed', { appId, error })
        return false
      }
    },
    [appId, ensureWebviewReady]
  )

  const getUsableWebview = useCallback(() => {
    const candidates = [webviewRef.current, attachedWebviewRef.current]

    for (const candidate of candidates) {
      const usable = ensureWebviewReady(candidate)
      if (usable) {
        return usable
      }
    }

    return null
  }, [ensureWebviewReady, webviewRef])

  const stopSearch = useCallback(() => {
    const target = getUsableWebview()
    if (!target) return
    stopFindOnWebview(target)
  }, [getUsableWebview, stopFindOnWebview])

  const closeSearch = useCallback(() => {
    setIsVisible(false)
    stopSearch()
    resetSearchState({ keepQuery: true })
  }, [resetSearchState, stopSearch])

  const performSearch = useCallback(
    (text: string, options?: Electron.FindInPageOptions) => {
      const target = getUsableWebview()
      if (!target) {
        logger.debug('Skip performSearch: webview not attached')
        return
      }
      if (!text) {
        stopSearch()
        resetSearchState({ keepQuery: true })
        return
      }
      try {
        target.findInPage(text, options)
      } catch (error) {
        logger.error('findInPage failed', { error })
        window.toast?.error(t('common.error'))
      }
    },
    [getUsableWebview, resetSearchState, stopSearch, t]
  )

  const handleFoundInPage = useCallback((event: Event & { result?: FoundInPageResult }) => {
    if (!event.result) return

    const { activeMatchOrdinal, matches } = event.result

    if (matches !== undefined) {
      setMatchCount(matches)
    }

    if (activeMatchOrdinal !== undefined) {
      setActiveIndex(activeMatchOrdinal)
    }
  }, [])

  const openSearch = useCallback(() => {
    if (!isWebviewReady) {
      logger.debug('Skip openSearch: webview not ready')
      return
    }
    setIsVisible(true)
    focusInput()
  }, [focusInput, isWebviewReady])

  const goToNext = useCallback(() => {
    if (!query) return
    performSearch(query, { forward: true, findNext: true })
  }, [performSearch, query])

  const goToPrevious = useCallback(() => {
    if (!query) return
    performSearch(query, { forward: false, findNext: true })
  }, [performSearch, query])

  useEffect(() => {
    attachedWebviewRef.current = activeWebview
    if (!activeWebview) {
      return
    }

    const handle = handleFoundInPage
    activeWebview.addEventListener('found-in-page', handle)

    return () => {
      activeWebview.removeEventListener('found-in-page', handle)
      if (attachedWebviewRef.current === activeWebview) {
        stopFindOnWebview(activeWebview)
        attachedWebviewRef.current = null
      }
    }
  }, [activeWebview, handleFoundInPage, stopFindOnWebview])

  useEffect(() => {
    if (!activeWebview) return
    if (!isWebviewReady) return
    const onFindShortcut = window.api?.webview?.onFindShortcut
    if (!onFindShortcut) return

    let webContentsId: number | undefined
    try {
      webContentsId = activeWebview.getWebContentsId?.()
    } catch (error) {
      logger.debug('WebviewSearch: getWebContentsId failed', { appId, error })
      return
    }

    if (!webContentsId) {
      logger.warn('WebviewSearch: missing webContentsId', { appId })
      return
    }

    const unsubscribe = onFindShortcut(({ webviewId, key, control, meta, shift }) => {
      if (webviewId !== webContentsId) return

      if ((control || meta) && key === 'f') {
        openSearch()
        return
      }

      if (!isVisible) return

      if (key === 'escape') {
        closeSearch()
        return
      }

      if (key === 'enter') {
        if (shift) {
          goToPrevious()
        } else {
          goToNext()
        }
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [appId, activeWebview, closeSearch, goToNext, goToPrevious, isVisible, isWebviewReady, openSearch])

  useEffect(() => {
    if (!isVisible) return
    focusInput()
  }, [focusInput, isVisible])

  useEffect(() => {
    if (!isVisible) return
    if (!query) {
      performSearch('')
      return
    }
    performSearch(query)
  }, [activeWebview, isVisible, performSearch, query])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        openSearch()
        return
      }

      if (!isVisible) return

      if (event.key === 'Escape') {
        event.preventDefault()
        closeSearch()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) {
          goToPrevious()
        } else {
          goToNext()
        }
      }
    }

    window.addEventListener('keydown', handleKeydown, true)
    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
    }
  }, [closeSearch, goToNext, goToPrevious, isVisible, openSearch])

  useEffect(() => {
    if (!isWebviewReady) {
      setIsVisible(false)
      resetSearchState()
      stopSearch()
      return
    }
  }, [isWebviewReady, resetSearchState, stopSearch])

  useEffect(() => {
    if (!appId) return
    if (lastAppIdRef.current === appId) return
    lastAppIdRef.current = appId
    setIsVisible(false)
    resetSearchState()
    stopSearch()
  }, [appId, resetSearchState, stopSearch])

  useEffect(() => {
    return () => {
      stopSearch()
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current)
        focusFrameRef.current = null
      }
    }
  }, [stopSearch])

  if (!isVisible) {
    return null
  }

  const matchLabel = `${matchCount > 0 ? Math.max(activeIndex, 1) : 0}/${matchCount}`
  const noResultTitle = matchCount === 0 && query ? t('common.no_results') : undefined
  const disableNavigation = !query || matchCount === 0

  return (
    <div className="pointer-events-auto absolute top-3 right-3 z-50 flex items-center gap-2 rounded-xl border border-default-200 bg-background px-2 py-1 shadow-lg">
      <Input
        ref={inputRef}
        autoFocus
        value={query}
        onValueChange={setQuery}
        spellCheck={'false'}
        placeholder={t('common.search')}
        size="sm"
        radius="sm"
        variant="flat"
        classNames={{
          base: 'w-[240px]',
          inputWrapper:
            'h-8 bg-transparent border border-transparent shadow-none hover:border-transparent hover:bg-transparent focus:border-transparent data-[hover=true]:border-transparent data-[focus=true]:border-transparent data-[focus-visible=true]:outline-none data-[focus-visible=true]:ring-0',
          input: 'text-small focus:outline-none focus-visible:outline-none',
          innerWrapper: 'gap-0'
        }}
      />
      <span
        className="min-w-[44px] text-center text-default-500 text-small tabular-nums"
        title={noResultTitle}
        role="status"
        aria-live="polite"
        aria-atomic="true">
        {matchLabel}
      </span>
      <div className="h-4 w-px bg-default-200" />
      <Button
        size="sm"
        variant="light"
        radius="full"
        isIconOnly
        onPress={goToPrevious}
        isDisabled={disableNavigation}
        aria-label="Previous match"
        className="text-default-500 hover:text-default-900">
        <ChevronUp size={16} />
      </Button>
      <Button
        size="sm"
        variant="light"
        radius="full"
        isIconOnly
        onPress={goToNext}
        isDisabled={disableNavigation}
        aria-label="Next match"
        className="text-default-500 hover:text-default-900">
        <ChevronDown size={16} />
      </Button>
      <div className="h-4 w-px bg-default-200" />
      <Button
        size="sm"
        variant="light"
        radius="full"
        isIconOnly
        onPress={closeSearch}
        aria-label={t('common.close')}
        className="text-default-500 hover:text-default-900">
        <X size={16} />
      </Button>
    </div>
  )
}

export default WebviewSearch
