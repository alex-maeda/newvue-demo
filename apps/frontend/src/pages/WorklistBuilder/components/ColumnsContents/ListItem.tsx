import React, { useRef } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { TbGripVertical } from 'react-icons/tb';
// import type { XYCoord } from 'dnd-core';

import { DragItem, ITEM_TYPE, ListItemProps } from './types';

const ListItem: React.FC<ListItemProps> = ({
  item,
  index,
  listIndex,
  isDisabled,
  onHover,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: ITEM_TYPE,
    item: () => {
      return { index, listIndex };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: ITEM_TYPE,
    drop: (draggedItem: DragItem) => {
      if (!ref.current) {
        return;
      }

      const dragIndex = draggedItem.index;

      if (draggedItem.listIndex !== listIndex && dragIndex === index) {
        return;
      }

      // const hoverBoundingRect = ref.current?.getBoundingClientRect();

      // // Get vertical middle
      // const hoverMiddleY =
      //   (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;

      // // Determine mouse position
      // const clientOffset = monitor.getClientOffset();

      // // Get pixels to the top
      // const hoverClientY = (clientOffset as XYCoord).y - hoverBoundingRect.top;

      // if (dragIndex < index && hoverClientY < hoverMiddleY) {
      //   return;
      // }

      // // Dragging upwards
      // if (dragIndex > index && hoverClientY > hoverMiddleY) {
      //   return;
      // }

      onHover(draggedItem, listIndex, index);

      draggedItem.index = index;
    },
  });

  const opacity = isDragging ? 0 : isDisabled ? 0.5 : 1;

  drag(drop(ref));

  return (
    <div ref={!isDisabled ? ref : null}>
      <TbGripVertical size={20} style={{ color: '#ADADAD', opacity }} />

      {item}
    </div>
  );
};

export default ListItem;
