import {
  FileExcelFilled,
  FileImageFilled,
  FileMarkdownFilled,
  FilePdfFilled,
  FilePptFilled,
  FileTextFilled,
  FileUnknownFilled,
  FileWordFilled,
  FileZipFilled,
  FolderOpenFilled,
  GlobalOutlined,
  LinkOutlined
} from '@ant-design/icons'
import ConfirmDialog from '@renderer/components/ConfirmDialog'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useAttachment } from '@renderer/hooks/useAttachment'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Flex, Image, Tooltip } from 'antd'
import { isEmpty } from 'lodash'
import type { FC, MouseEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  files: FileMetadata[]
  setFiles: (files: FileMetadata[]) => void
  onAttachmentContextMenu?: (file: FileMetadata, event: MouseEvent<HTMLDivElement>) => void
}

const MAX_FILENAME_DISPLAY_LENGTH = 20
function truncateFileName(name: string, maxLength: number = MAX_FILENAME_DISPLAY_LENGTH) {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength - 3) + '...'
}

export const getFileIcon = (type?: string) => {
  if (!type) return <FileUnknownFilled />

  const ext = type.toLowerCase()

  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
    return <FileImageFilled />
  }

  if (['.doc', '.docx'].includes(ext)) {
    return <FileWordFilled />
  }
  if (['.xls', '.xlsx'].includes(ext)) {
    return <FileExcelFilled />
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return <FilePptFilled />
  }
  if (ext === '.pdf') {
    return <FilePdfFilled />
  }
  if (['.md', '.markdown'].includes(ext)) {
    return <FileMarkdownFilled />
  }

  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return <FileZipFilled />
  }

  if (['.txt', '.json', '.log', '.yml', '.yaml', '.xml', '.csv', '.tscn', '.gd'].includes(ext)) {
    return <FileTextFilled />
  }

  if (['.url'].includes(ext)) {
    return <LinkOutlined />
  }

  if (['.sitemap'].includes(ext)) {
    return <GlobalOutlined />
  }

  if (['.folder'].includes(ext)) {
    return <FolderOpenFilled />
  }

  return <FileUnknownFilled />
}

export const FileNameRender: FC<{ file: FileMetadata }> = ({ file }) => {
  const { preview } = useAttachment()
  const [visible, setVisible] = useState<boolean>(false)
  const isImage = (ext: string) => {
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext.toLocaleLowerCase())
  }

  const fullName = FileManager.formatFileName(file)
  const displayName = truncateFileName(fullName)

  return (
    <Tooltip
      styles={{
        body: {
          padding: 5
        }
      }}
      fresh
      title={
        <Flex vertical gap={2} align="center">
          {isImage(file.ext) && (
            <Image
              style={{ width: 80, maxHeight: 200 }}
              src={'file://' + FileManager.getSafePath(file)}
              preview={{
                visible: visible,
                src: 'file://' + FileManager.getSafePath(file),
                onVisibleChange: setVisible
              }}
            />
          )}
          <span style={{ wordBreak: 'break-all' }}>{fullName}</span>
          {formatFileSize(file.size)}
        </Flex>
      }>
      <FileName
        onClick={() => {
          if (isImage(file.ext)) {
            setVisible(true)
            return
          }
          const path = FileManager.getSafePath(file)
          const name = FileManager.formatFileName(file)
          preview(path, name, file.type, file.ext)
        }}
        title={fullName}>
        {displayName}
      </FileName>
    </Tooltip>
  )
}

const AttachmentPreview: FC<Props> = ({ files, setFiles, onAttachmentContextMenu }) => {
  const { t } = useTranslation()
  const [contextMenu, setContextMenu] = useState<{
    file: FileMetadata
    x: number
    y: number
  } | null>(null)

  const handleContextMenu = async (file: FileMetadata, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    // 获取被点击元素的位置
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()

    // 计算对话框位置：附件标签的中心位置
    const x = rect.left + rect.width / 2
    const y = rect.top

    try {
      const isText = await window.api.file.isTextFile(file.path)
      if (!isText) {
        setContextMenu(null)
        return
      }

      setContextMenu({
        file,
        x,
        y
      })
    } catch (error) {
      setContextMenu(null)
    }
  }

  const handleConfirm = () => {
    if (contextMenu && onAttachmentContextMenu) {
      // Create a synthetic mouse event for the callback
      const syntheticEvent = {
        preventDefault: () => {},
        stopPropagation: () => {}
      } as MouseEvent<HTMLDivElement>
      onAttachmentContextMenu(contextMenu.file, syntheticEvent)
    }
    setContextMenu(null)
  }

  const handleCancel = () => {
    setContextMenu(null)
  }

  if (isEmpty(files)) {
    return null
  }

  return (
    <>
      <ContentContainer>
        {files.map((file) => (
          <CustomTag
            key={file.id}
            icon={getFileIcon(file.ext)}
            color="#37a5aa"
            closable
            onClose={() => setFiles(files.filter((f) => f.id !== file.id))}
            onContextMenu={(event) => {
              void handleContextMenu(file, event)
            }}>
            <FileNameRender file={file} />
          </CustomTag>
        ))}
      </ContentContainer>

      {contextMenu && (
        <ConfirmDialog
          x={contextMenu.x}
          y={contextMenu.y}
          message={t('chat.input.paste_text_file_confirm')}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  )
}

const ContentContainer = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 4px;
`

const FileName = styled.span`
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`

export default AttachmentPreview
