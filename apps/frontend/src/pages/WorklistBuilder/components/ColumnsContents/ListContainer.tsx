import React from 'react';
import { useDrop } from 'react-dnd';

import ListItem from './ListItem';

import { TColumnSetting } from '../../../../models/Filter';
import { DragItem, ITEM_TYPE } from './types';

import { getNameByAccessor } from '../../../../utils/TableUtil';

const ListContainer: React.FC<{
  items: TColumnSetting[];
  listIndex: number;
  onItemDrop: (
    source: DragItem,
    targetListIndex: number,
    targetIndex?: number,
  ) => void;
}> = ({ items, listIndex, onItemDrop }) => {
  const [{ isOver }, drop] = useDrop({
    accept: ITEM_TYPE,
    drop: (draggedItem: DragItem) => {
      if (draggedItem.listIndex === listIndex) {
        return;
      }
      onItemDrop(draggedItem, listIndex);
      draggedItem.listIndex = listIndex;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  return (
    <div
      ref={drop}
      style={{
        backgroundColor: isOver ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
      }}
      className="columns-list-wrapper"
    >
      {items.map(
        (item, index) =>
          item && (
            <ListItem
              key={item.accessor}
              item={getNameByAccessor(item.accessor)}
              index={index}
              listIndex={listIndex}
              isDisabled={item.accessor === 'actions'}
              onHover={onItemDrop}
            />
          ),
      )}
    </div>
  );
};

export default ListContainer;
