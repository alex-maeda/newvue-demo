import { FC, useEffect, useMemo, useState, useRef } from 'react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { useParams } from 'react-router-dom';

import { setCurrentExamination } from '../../../../redux/reducers/clinicalReducer';
import { TVisitHistory } from '../../../../models/Consideration';
import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { getTimelinePositions } from '../../../../utils/TimelinePositionUtils';

const ClinicalTimeLine: FC<{
  setIsShow: (value: boolean | ((value: boolean) => boolean)) => void;
}> = ({ setIsShow }) => {
  const {
    getPatientClinicalHistory: { data, currentExamination },
    radiologyReportType,
  } = useAppSelector(({ clinical }) => clinical);
  const { currentFilterId } = useAppSelector(({ filter }) => filter);
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  const [startDate, setStartDate] = useState<Date | number>(0);
  const [timeLineData, setTimeLineData] = useState<TVisitHistory[]>([]);
  const [hoveredItem, setHoveredItem] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  const dispatch = useAppDispatch();
  const { patientId } = useParams();

  const reportsType = radiologyReportType?.[String(patientId)];

  const today = new Date();
  const daysInRange = differenceInDays(today, startDate) + 1;
  //const formattedStartDate = format(startDate, 'MMMM yyyy');

  useEffect(() => {
    const visitHistory = data?.visitHistory ?? [];
    const isNeedFiltered =
      reportsType === 'Relevant reports' &&
      (patientId === String(1) || patientId === String(2)) &&
      currentFilterId === 0;

    const filteredVisitHistory = isNeedFiltered
      ? visitHistory.filter((i) => i.abbreviation !== 'CT')
      : visitHistory;

    // Sort by date in descending order (newest to oldest)
    const sortedVisitHistory = [...filteredVisitHistory].sort((a, b) => {
      const dateA = parseISO(a.date);
      const dateB = parseISO(b.date);
      return dateB.getTime() - dateA.getTime();
    });

    setTimeLineData(sortedVisitHistory);
    if (sortedVisitHistory?.length) {
      const lastDate = parseISO(
        sortedVisitHistory[sortedVisitHistory.length - 1].date, // Use last item (oldest) as start date
      );
      setStartDate(lastDate);
    }
  }, [data, reportsType]);

  const handleSetActive = (item: TVisitHistory) => {
    dispatch(setCurrentExamination(item));
    setIsShow(true);
  };

  const handleMouseEnter = (
    item: TVisitHistory,
    event: React.MouseEvent<HTMLSpanElement>,
  ) => {
    if (item.id === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoveredItem(item.id);
    setTooltipPosition({
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
    });
  };

  const handleMouseLeave = () => {
    setHoveredItem(null);
  };

  const timelineEventPositions = useMemo(
    () => getTimelinePositions(timeLineData, daysInRange, today, 10),
    [timeLineData, daysInRange, today],
  );

  return (
    <>
      <div className="clinical-timeline-wrapper">
        <strong className="timeline-year">{format(today, 'yyyy')}</strong>
        <div className="timeline-vertical">
          <div className="vertical-timeline-wrapper">
            <div
              className={`vertical-timeline${
                isKonicaBranding ? ' isKonicaBranding' : ''
              }`}
            >
              {timeLineData.map((item: TVisitHistory, index: number) => {
                const position = timelineEventPositions[index];
                const itemDate = parseISO(item.date);

                return (
                  <div
                    key={`${item.id}-${item.type}-${index}`}
                    className="timeline-event"
                    style={{
                      top: `${position}%`,
                      // display: position > 100 ? 'none' : 'flex',
                    }}
                  >
                    <span className="timeline-date">
                      {format(itemDate, 'M/d')}
                    </span>
                    <span
                      className={`timeline-marker text ${
                        currentExamination?.id === item.id &&
                        currentExamination?.type === item.type
                          ? 'active'
                          : ''
                      }`}
                      onClick={() => {
                        handleSetActive(item);
                      }}
                      onMouseEnter={(e) => handleMouseEnter(item, e)}
                      onMouseLeave={handleMouseLeave}
                    >
                      {item.abbreviation}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {hoveredItem !== null && (
          <div
            ref={tooltipRef}
            className="timeline-tooltip"
            style={{
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
            }}
          >
            {timeLineData.find((item) => item.id === hoveredItem)?.title}
          </div>
        )}
      </div>
    </>
  );
};

export default ClinicalTimeLine;
