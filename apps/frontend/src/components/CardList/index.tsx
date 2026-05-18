import { useEffect, useRef } from 'react';
import { useAppSelector } from '../../hooks/hooks';
import './style.scss';

export interface CardItem {
  id?: number;
  title: string;
  date: string;
  status?: string;
}

interface CardListProps<T extends CardItem> {
  items: T[];
  onItemClick: (item: T) => void;
  formatDateTime?: (date: string) => string;
  noDataMessage?: string;
  getBadgeLabel?: (item: T) => string;
}

const CardList = <T extends CardItem>({
  items,
  onItemClick,
  formatDateTime,
  noDataMessage = 'No items available',
  getBadgeLabel,
}: CardListProps<T>): JSX.Element => {
  const { highlightedItemId } = useAppSelector(({ erik }) => erik);
  const highlightedRef = useRef<HTMLDivElement>(null);
  const defaultFormatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    const timezoneOffset = -date.getTimezoneOffset() / 60;
    const timezoneString = `${timezoneOffset >= 0 ? '+' : ''}${String(
      Math.floor(timezoneOffset),
    ).padStart(2, '0')}:00`;

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${timezoneString}`;
  };

  const formatDate = formatDateTime || defaultFormatDateTime;

  // Scroll to highlighted item when it changes
  useEffect(() => {
    if (highlightedItemId !== null && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightedItemId]);

  return (
    <div className="card-list">
      {items.length > 0 ? (
        items.map((item, index) => {
          const isHighlighted = item.id === highlightedItemId;
          return (
            <div
              key={item.id || index}
              ref={isHighlighted ? highlightedRef : null}
              className={`card-item${isHighlighted ? ' erik-highlighted' : ''}`}
            >
              <div className="card-item-left">
                <span className="card-status-badge">
                  {getBadgeLabel ? getBadgeLabel(item) : item.status || 'final'}
                </span>
                <div className="card-info">
                  <div className="card-title">{item.title}</div>
                  <div className="card-date">• {formatDate(item.date)}</div>
                </div>
              </div>
              <button
                className="card-open-btn"
                onClick={() => onItemClick(item)}
              >
                Open
              </button>
            </div>
          );
        })
      ) : (
        <p className="no-data-message">{noDataMessage}</p>
      )}
    </div>
  );
};

export default CardList;
