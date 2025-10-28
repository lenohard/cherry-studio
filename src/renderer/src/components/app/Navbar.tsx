import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import type { FC, PropsWithChildren } from 'react'
import type { HTMLAttributes } from 'react'
import styled from 'styled-components'

import WindowControls from '../WindowControls'

type Props = PropsWithChildren & HTMLAttributes<HTMLDivElement>

export const Navbar: FC<Props> = ({ children, ...props }) => {
  const backgroundColor = useNavBackgroundColor()
  const isFullscreen = useFullscreen()
  const { isTopNavbar } = useNavbarPosition()
  const { minappShow } = useRuntime()

  if (isTopNavbar) {
    return null
  }

  return (
    <>
      <NavbarContainer {...props} style={{ backgroundColor }} $isFullScreen={isFullscreen}>
        {children}
      </NavbarContainer>
      {!isTopNavbar && !minappShow && <WindowControls />}
    </>
  )
}

export const NavbarLeft: FC<Props> = ({ children, ...props }) => {
  return <NavbarLeftContainer {...props}>{children}</NavbarLeftContainer>
}

export const NavbarCenter: FC<Props> = ({ children, ...props }) => {
  return <NavbarCenterContainer {...props}>{children}</NavbarCenterContainer>
}

export const NavbarRight: FC<Props> = ({ children, ...props }) => {
  const isFullscreen = useFullscreen()
  return (
    <NavbarRightContainer {...props} $isFullscreen={isFullscreen}>
      {children}
    </NavbarRightContainer>
  )
}

export const NavbarMain: FC<Props> = ({ children, ...props }) => {
  const isFullscreen = useFullscreen()
  return (
    <NavbarMainContainer {...props} $isFullscreen={isFullscreen}>
      {children}
    </NavbarMainContainer>
  )
}

export const NavbarHeader: FC<Props> = ({ children, ...props }) => {
  return <NavbarHeaderContent {...props}>{children}</NavbarHeaderContent>
}

const NavbarContainer = styled.div<{ $isFullScreen: boolean }>`
  min-width: 100%;
  display: flex;
  flex-direction: row;
  min-height: ${({ $isFullScreen }) => (!$isFullScreen && isMac ? 'env(titlebar-area-height)' : 'var(--navbar-height)')};
  max-height: var(--navbar-height);
  margin-left: ${isMac ? 'calc(var(--sidebar-width) * -1 + 2px)' : 0};
  padding-left: ${({ $isFullScreen }) =>
    isMac ? ($isFullScreen ? 'var(--sidebar-width)' : 'env(titlebar-area-x)') : 0};
  -webkit-app-region: drag;
`

const NavbarLeftContainer = styled.div`
  /* min-width: ${isMac ? 'calc(var(--assistants-width) - 20px)' : 'var(--assistants-width)'}; */
  padding: 0 10px;
  display: flex;
  flex-direction: row;
  align-items: center;
  font-weight: bold;
  color: var(--color-text-1);
`

const NavbarCenterContainer = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  padding: 0 ${isMac ? '20px' : 0};
  padding-left: 10px;
  font-weight: bold;
  color: var(--color-text-1);
  position: relative;
`

const NavbarRightContainer = styled.div<{ $isFullscreen: boolean }>`
  min-width: var(--topic-list-width);
  display: flex;
  align-items: center;
  padding: 0 12px;
  justify-content: flex-end;
  flex: 1;
`

const NavbarMainContainer = styled.div<{ $isFullscreen: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-right: ${isMac ? '20px' : 0};
  padding-left: 10px;
  font-weight: bold;
  color: var(--color-text-1);
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '12px' : isWin ? '140px' : isLinux ? '120px' : '12px')};
`

const NavbarHeaderContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  min-height: var(--navbar-height);
  max-height: var(--navbar-height);
`
