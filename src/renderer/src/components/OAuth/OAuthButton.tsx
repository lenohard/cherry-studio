import { getProviderLabel } from '@renderer/i18n/label'
import type { Provider } from '@renderer/types'
import {
  oauthWith302AI,
  oauthWithAihubmix,
  oauthWithAiOnly,
  oauthWithPPIO,
  oauthWithSiliconFlow,
  oauthWithTokenFlux
} from '@renderer/utils/oauth'
import type { ButtonProps } from 'antd'
import { Button } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props extends ButtonProps {
  provider: Provider
  onSuccess?: (key: string) => void
}

const OAuthButton: FC<Props> = ({ provider, onSuccess, ...buttonProps }) => {
  const { t } = useTranslation()

  const onAuth = () => {
    const handleSuccess = (key: string) => {
      if (key.trim()) {
        onSuccess?.(key)
        window.toast.success(t('auth.get_key_success'))
      }
    }

    if (provider.id === 'silicon') {
      oauthWithSiliconFlow(handleSuccess)
    }

    if (provider.id === 'aihubmix') {
      oauthWithAihubmix(handleSuccess)
    }

    if (provider.id === 'ppio') {
      oauthWithPPIO(handleSuccess)
    }

    if (provider.id === 'tokenflux') {
      oauthWithTokenFlux()
    }

    if (provider.id === '302ai') {
      oauthWith302AI(handleSuccess)
    }

    if (provider.id === 'aionly') {
      oauthWithAiOnly(handleSuccess)
    }
  }

  return (
    <Button type="primary" onClick={onAuth} shape="round" {...buttonProps}>
      {t('settings.provider.oauth.button', { provider: getProviderLabel(provider.id) })}
    </Button>
  )
}

export default OAuthButton
