import React, { FC, useCallback, useRef } from 'react';
import { Button, Checkbox } from 'antd';
import type { CheckboxChangeEvent } from 'antd/es/checkbox';
import type { Identifier, XYCoord } from 'dnd-core';
import { useDrag, useDrop } from 'react-dnd';
import { IoLinkOutline, IoUnlinkOutline } from 'react-icons/io5';
import update from 'immutability-helper';

import { IFilter } from '../../../../models/Filter';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import {
  getLinkedResult,
  moveFilters,
  setFiltersCombine,
  setLastCheckedFilter,
} from '../../../../redux/reducers/filterReducer';

const ITEM_TYPE = 'card';

interface DragItem {
  index: number;
  id: number;
  type: string;
}

const FilterCard: FC<{
  value: IFilter;
  index: number;
}> = ({ value, index }) => {
  const dispatch = useAppDispatch();
  const { filters } = useAppSelector(({ filter }) => filter);
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);
  const ref = useRef<HTMLInputElement>(null);

  const moveCard = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      const newFilters = update(filters, {
        $splice: [
          [dragIndex, 1],
          [hoverIndex, 0, filters[dragIndex]],
        ],
      });

      dispatch(moveFilters(newFilters));
    },
    [filters],
  );

  const handleChangeCombine = () => {
    dispatch(setFiltersCombine(value.id));
    dispatch(getLinkedResult());
  };

  const handleCheck = (e: CheckboxChangeEvent) => {
    if (value.isCombine && !e.target.checked) {
      handleChangeCombine();
    }
    dispatch(setLastCheckedFilter(e.target.checked ? e.target.value : ''));
  };

  const [{ handlerId }, drop] = useDrop<
    DragItem,
    void,
    { handlerId: Identifier | null }
  >({
    accept: ITEM_TYPE,
    collect(monitor) {
      return {
        handlerId: monitor.getHandlerId(),
      };
    },
    drop(item: DragItem, monitor) {
      if (!ref.current) {
        return;
      }
      const dragIndex = item.index;
      const hoverIndex = index;

      // Don't replace items with themselves
      if (dragIndex === hoverIndex) {
        return;
      }

      // Determine rectangle on screen
      const hoverBoundingRect = ref.current?.getBoundingClientRect();

      // Get vertical middle
      const hoverMiddleY =
        (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;

      // Determine mouse position
      const clientOffset = monitor.getClientOffset();

      // Get pixels to the top
      const hoverClientY = (clientOffset as XYCoord).y - hoverBoundingRect.top;

      // Only perform the move when the mouse has crossed half of the items height
      // When dragging downwards, only move when the cursor is below 50%
      // When dragging upwards, only move when the cursor is above 50%

      // Dragging downwards
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }

      // Dragging upwards
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }

      // Time to actually perform the action
      moveCard(dragIndex, hoverIndex);

      // Note: we're mutating the monitor item here!
      // Generally it's better to avoid mutations,
      // but it's good here for the sake of performance
      // to avoid expensive index searches.
      item.index = hoverIndex;
    },
  });

  const [{ isDragging }, drag] = useDrag({
    type: ITEM_TYPE,
    item: () => {
      return { id: value.id, index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const opacity = isDragging ? 0 : 1;

  drag(drop(ref));

  return (
    <div>
      <div className="circle-indicator">
        <div className={value.priorityColor} />
      </div>
      <Button
        type="link"
        onClick={handleChangeCombine}
        icon={
          !value.isCombine ? (
            <IoUnlinkOutline size={20} />
          ) : (
            <IoLinkOutline
              size={20}
              color={isKonicaBranding ? '#a6daef' : '#A1D103'}
            />
          )
        }
      />
      <Checkbox
        id={`worklist${value.id}`}
        className="worklist-item"
        style={{ opacity }}
        value={value.id}
        onChange={handleCheck}
      >
        <span ref={ref} data-handler-id={handlerId}>
          {value.label}
        </span>
      </Checkbox>
      <span>{value.resultCount}</span>
    </div>
  );
};

export default FilterCard;
