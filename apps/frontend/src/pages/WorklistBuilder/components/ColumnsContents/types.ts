export interface ListItemProps {
  item: string;
  index: number;
  listIndex: number;
  isDisabled: boolean;
  onHover: (
    source: DragItem,
    targetListIndex: number,
    targetIndex?: number,
  ) => void;
}

export interface DragItem {
  index: number;
  listIndex: number;
}

export const ITEM_TYPE = 'Column';
