import { useSortable } from '@dnd-kit/sortable'

import { ItemRenderer } from './ItemRenderer'
import type { RenderItemType } from './types'

interface SortableItemProps<T> {
  item: T
  id: string | number
  index: number
  renderItem: RenderItemType<T>
  useDragOverlay?: boolean
  showGhost?: boolean
  itemStyle?: React.CSSProperties
}

export function SortableItem<T>({
  item,
  id,
  index,
  renderItem,
  useDragOverlay = true,
  showGhost = true,
  itemStyle
}: SortableItemProps<T>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id
  })

  return (
    <ItemRenderer
      ref={setNodeRef}
      item={item}
      index={index}
      renderItem={renderItem}
      dragging={isDragging}
      dragOverlay={!useDragOverlay && isDragging}
      ghost={showGhost && useDragOverlay && isDragging}
      transform={transform}
      transition={transition}
      listeners={listeners}
      itemStyle={itemStyle}
      {...attributes}
    />
  )
}
