import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ScrollShadow } from '@heroui/react'
import { loggerService } from '@logger'
import { handleSaveData } from '@renderer/store'
import type { ReleaseNoteInfo, UpdateInfo } from 'builder-util-runtime'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'

const logger = loggerService.withContext('UpdateDialog')

interface UpdateDialogProps {
  isOpen: boolean
  onClose: () => void
  releaseInfo: UpdateInfo | null
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({ isOpen, onClose, releaseInfo }) => {
  const { t } = useTranslation()
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    if (isOpen && releaseInfo) {
      logger.info('Update dialog opened', { version: releaseInfo.version })
    }
  }, [isOpen, releaseInfo])

  const handleInstall = async () => {
    setIsInstalling(true)
    try {
      await handleSaveData()
      await window.api.quitAndInstall()
    } catch (error) {
      logger.error('Failed to save data before update', error as Error)
      setIsInstalling(false)
      window.toast.error(t('update.saveDataError'))
    }
  }

  const releaseNotes = releaseInfo?.releaseNotes

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      scrollBehavior="inside"
      classNames={{
        base: 'max-h-[85vh]',
        header: 'border-b border-divider',
        footer: 'border-t border-divider'
      }}>
      <ModalContent>
        {(onModalClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <h3 className="font-semibold text-lg">{t('update.title')}</h3>
              <p className="text-default-500 text-small">
                {t('update.message').replace('{{version}}', releaseInfo?.version || '')}
              </p>
            </ModalHeader>

            <ModalBody>
              <ScrollShadow className="max-h-[450px]" hideScrollBar>
                <div className="markdown rounded-lg bg-default-50 p-4">
                  <Markdown>
                    {typeof releaseNotes === 'string'
                      ? releaseNotes
                      : Array.isArray(releaseNotes)
                        ? releaseNotes
                            .map((note: ReleaseNoteInfo) => note.note)
                            .filter(Boolean)
                            .join('\n\n')
                        : t('update.noReleaseNotes')}
                  </Markdown>
                </div>
              </ScrollShadow>
            </ModalBody>

            <ModalFooter>
              <Button variant="light" onPress={onModalClose} isDisabled={isInstalling}>
                {t('update.later')}
              </Button>

              <Button
                color="primary"
                onPress={async () => {
                  await handleInstall()
                  onModalClose()
                }}
                isLoading={isInstalling}>
                {t('update.install')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export default UpdateDialog
