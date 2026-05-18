import { FC, useEffect, useMemo, useState } from 'react';
import { format, parseISO, differenceInDays } from 'date-fns';

import { TExamHistory } from '../../../redux/types/followUpTypes';

import { formateDate } from '../../../utils/DateUtils';
import { typeIconsMap } from '../utils';

import '../style.scss';
import { getTimelinePositions } from '../../../utils/TimelinePositionUtils';
import { useAppSelector } from '../../../hooks/hooks';

const VerticalTimeline: FC<{
  examHistory: TExamHistory[];
  navigateToTypeArea: (index: number) => void;
}> = ({ examHistory, navigateToTypeArea }) => {
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);
  const [startDate, setStartDate] = useState<Date | number>(0);
  const [timeLineData, setTimeLineData] = useState<TExamHistory[]>([]);
  const [active, setActive] = useState<number>();

  const today = new Date();
  const daysInRange = differenceInDays(today, startDate) + 1;
  const formattedStartDate = format(startDate, 'MMMM yyyy');

  useEffect(() => {
    setTimeLineData(examHistory ?? []);
    if (examHistory?.length) {
      const lastDate = parseISO(examHistory[0].date);
      setStartDate(lastDate);
    }
  }, [examHistory]);

  const handleClick = (index: number) => {
    setActive(index);
    navigateToTypeArea(index);
  };

  const prepareDateForShow = (date: string) => {
    const [MM, dd, yyyy] = formateDate(date).split('/');
    return `${MM}/${dd}
    ${yyyy}`;
  };

  const timelineEventPositions = useMemo(
    () => getTimelinePositions(timeLineData, daysInRange, today, 15),
    [timeLineData, daysInRange, today],
  );

  return (
    <>
      <div className="timeline-vertical">
        <div className="vertical-timeline-wrapper">
          <div
            className={`vertical-timeline${
              isKonicaBranding ? ' isKonicaBranding' : ''
            }`}
          >
            {timeLineData.map((i: TExamHistory, index: number) => {
              const { icon } = typeIconsMap[i.type];
              const position = timelineEventPositions[index];

              return (
                <div
                  key={index}
                  className={active === index ? 'active' : ''}
                  style={{
                    top: `${position}%`,
                    display: position > 99 ? 'none' : 'flex',
                  }}
                >
                  <span
                    className={`${icon} ${active === index ? 'active' : ''}`}
                    onClick={() => handleClick(index)}
                  />
                  {active === index && (
                    <>
                      <span className="date">{prepareDateForShow(i.date)}</span>
                      <span className="divider"></span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <strong className="end-day">Today</strong>
      <strong className="start-day">{formattedStartDate}</strong>
    </>
  );
};

export default VerticalTimeline;
