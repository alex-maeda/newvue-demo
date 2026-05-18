import { RefObject, useEffect, useRef, useState } from 'react';
import { DEFAULT_MIN_COLUMN_WIDTH } from '../utils/GeneralUtil';

const useDefaultColumnWidth = (
  count: number,
  isAction?: boolean,
): {
  panelRef: RefObject<HTMLDivElement>;
  defaultWidth: number;
  calculateColumnWidth: () => void;
} => {
  const [defaultWidth, setDefaultWidth] = useState<number>(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const calculateColumnWidth = () => {
    if (panelRef.current) {
      const width = isAction
        ? panelRef.current.clientWidth - DEFAULT_MIN_COLUMN_WIDTH
        : panelRef.current.clientWidth;
      const colWidth = width / count;
      setDefaultWidth(
        colWidth < DEFAULT_MIN_COLUMN_WIDTH
          ? DEFAULT_MIN_COLUMN_WIDTH
          : colWidth,
      );
    }
  };

  useEffect(() => {
    calculateColumnWidth();
  }, [panelRef.current]);

  return { panelRef, defaultWidth, calculateColumnWidth };
};

export default useDefaultColumnWidth;
