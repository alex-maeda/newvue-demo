import { ReactNode } from 'react';
import { IoMdClose } from 'react-icons/io';
import './DataTableModal.scss';

export interface TableColumn<T> {
  header: string;
  accessor: keyof T | ((row: T) => ReactNode);
  className?: string;
  render?: (value: unknown, row: T) => ReactNode;
}

interface DataTableModalProps<T> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  data: T[];
  columns: TableColumn<T>[];
  className?: string;
}

function DataTableModal<T>({
  isOpen,
  onClose,
  title,
  data,
  columns,
  className = '',
}: DataTableModalProps<T>) {
  if (!isOpen) return null;

  const getCellValue = (row: T, column: TableColumn<T>): unknown => {
    if (typeof column.accessor === 'function') {
      return column.accessor(row);
    }
    return row[column.accessor];
  };

  // const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
  //   if (e.target === e.currentTarget) {
  //     onClose();
  //   }
  // };

  const isProblemsTable = title === 'Problem Decisions';

  return (
    <div className={`nv-modal ${className}`}>
      <div className="nv-modal__backdrop" onClick={onClose} />
      <div className="nv-modal__panel">
        <div className="nv-modal__header">
          <h2>{title}</h2>
          <button
            type="button"
            className="nv-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <IoMdClose />
          </button>
        </div>
        <div className="nv-modal__body">
          <div className={`dl-table ${isProblemsTable ? 'dl-problems' : ''}`}>
            {/* Header row */}
            <div className="dl-row dl-head">
              {columns.map((column, index) => (
                <div key={index}>{column.header}</div>
              ))}
            </div>
            {/* Data rows */}
            {data.map((row, rowIndex) => (
              <div key={rowIndex} className="dl-row">
                {columns.map((column, colIndex) => {
                  const value = getCellValue(row, column);
                  const renderedValue = column.render
                    ? column.render(value, row)
                    : (value as ReactNode);

                  // Apply special formatting for checkmarks
                  if (
                    column.className?.includes('check-cell') ||
                    column.className?.includes('include-cell')
                  ) {
                    const isChecked = renderedValue === '✓';
                    return (
                      <div key={colIndex} className={column.className || ''}>
                        <span
                          className={`dl-check ${isChecked ? 'yes' : 'no'}`}
                        >
                          {renderedValue}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div key={colIndex} className={column.className || ''}>
                      {renderedValue}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DataTableModal as <T>(
  props: DataTableModalProps<T>,
) => JSX.Element;
