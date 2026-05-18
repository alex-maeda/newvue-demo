import { FC, useEffect, useState } from 'react';
import {
  format,
  parseISO,
  differenceInDays,
  isAfter,
  isBefore,
  subMonths,
} from 'date-fns';
import { Slider, Button } from 'antd';
import { AiOutlineMinus, AiOutlinePlus } from 'react-icons/ai';
import { setCurrentExamination } from '../../../../redux/reducers/clinicalReducer';
import { TVisitHistory } from '../../../../models/Consideration';
import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';

const Timeline: FC<{
  setIsShow: (value: boolean | ((value: boolean) => boolean)) => void;
}> = ({ setIsShow }) => {
  const {
    getPatientClinicalHistory: { data, currentExamination },
  } = useAppSelector(({ clinical }) => clinical);
  const [sliderValue, setSliderValue] = useState<number>(100);
  const [startDate, setStartDate] = useState<Date | number>(0);
  const [timeLineData, setTimeLineData] = useState<TVisitHistory[]>([]);
  const [hoveredItem, setHoveredItem] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const dispatch = useAppDispatch();

  const today = new Date();
  const daysInRange = differenceInDays(today, startDate) + 1;
  const formattedStartDate = format(startDate, 'MMMM yyyy');

  const positionForDate = (date: Date) => {
    const dayDifference = differenceInDays(today, date);
    return `${(dayDifference / daysInRange) * 100}%`;
  };

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

  const handlePlus = () => {
    if (sliderValue !== 100) {
      setSliderValue((prev) => {
        const newValue = prev + 25;
        handleSliderChange(newValue);
        return newValue;
      });
    }
  };

  const handleMinus = () => {
    if (sliderValue !== 0) {
      setSliderValue((prev) => {
        const newValue = prev - 25;
        handleSliderChange(newValue);
        return newValue;
      });
    }
  };

  const handleSliderChange = (value: number) => {
    const firstDate = parseISO((data?.visitHistory ?? [])[0].date);
    const lastDate = parseISO(
      (data?.visitHistory ?? [])[(data?.visitHistory ?? []).length - 1].date,
    );

    if (value === 0) {
      const oneMonthAgo = subMonths(today, 1);
      const filteredTimelineConfig = (data?.visitHistory ?? []).filter(
        (item: TVisitHistory) => {
          const itemDate = parseISO(item.date);
          return isAfter(itemDate, oneMonthAgo) && isBefore(itemDate, today);
        },
      );
      setTimeLineData(filteredTimelineConfig);
      setStartDate(oneMonthAgo);
    }
    if (value === 25) {
      const middleDateInConfig = new Date(
        (firstDate.getTime() + lastDate.getTime()) / 2,
      );
      const middleDate = new Date(
        (today.getTime() + middleDateInConfig.getTime()) / 2,
      );

      const filteredTimelineConfig = (data?.visitHistory ?? []).filter(
        (item: TVisitHistory) => {
          const itemDate = parseISO(item.date);
          return isAfter(itemDate, middleDate) && isBefore(itemDate, today);
        },
      );
      setTimeLineData(filteredTimelineConfig);
      setStartDate(middleDate);
    }
    if (value === 50) {
      const middleDate = new Date((today.getTime() + lastDate.getTime()) / 2);
      const filteredTimelineConfig = (data?.visitHistory ?? []).filter(
        (item: TVisitHistory) => {
          const itemDate = parseISO(item.date);
          return isAfter(itemDate, middleDate) && isBefore(itemDate, today);
        },
      );
      setTimeLineData(filteredTimelineConfig);
      setStartDate(middleDate);
    }
    if (value === 75) {
      const middleOfTotalRange = new Date(
        (firstDate.getTime() + lastDate.getTime()) / 2,
      );
      const middleOfSecondHalf = new Date(
        (middleOfTotalRange.getTime() + lastDate.getTime()) / 2,
      );
      const filteredTimelineConfig = (data?.visitHistory ?? []).filter(
        (item: TVisitHistory) => {
          const itemDate = parseISO(item.date);
          return (
            isAfter(itemDate, middleOfSecondHalf) && isBefore(itemDate, today)
          );
        },
      );
      setTimeLineData(filteredTimelineConfig);
      setStartDate(middleOfSecondHalf);
    }
    if (value === 100) {
      setTimeLineData(data?.visitHistory ?? []);
      setStartDate(lastDate);
    }
    setSliderValue(value);
  };

  useEffect(() => {
    setTimeLineData(data?.visitHistory ?? []);
    if (data?.visitHistory?.length) {
      const lastDate = parseISO(
        data.visitHistory[data.visitHistory.length - 1].date,
      );
      setStartDate(lastDate);
    }
  }, [data]);

  useEffect(() => {
    if (currentExamination) {
      const timelineDateArr = timeLineData.map((i) => i.date);
      !timelineDateArr.includes(currentExamination.date) &&
        handleSliderChange(100);
    }
  }, [currentExamination]);

  return (
    <>
      <div className="timeline-wrapper-horizontal">
        <div className="timeline">
          {timeLineData.map((item: TVisitHistory) => (
            <span
              key={item.id}
              className={`${item.class} ${
                currentExamination?.id === item.id ? 'active' : ''
              }`}
              style={{ left: positionForDate(parseISO(item.date)) }}
              onClick={() => handleSetActive(item)}
              onMouseEnter={(e) => handleMouseEnter(item, e)}
              onMouseLeave={handleMouseLeave}
            >
              {item.abbreviation}
            </span>
          ))}
          <strong className="end-day">Today</strong>
          <strong className="start-day">{formattedStartDate}</strong>
        </div>
        {hoveredItem !== null && (
          <div
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

      <div>
        <div>
          <Button
            type="text"
            className="less"
            icon={<AiOutlineMinus color="#89c4f4" size={20} />}
            onClick={handleMinus}
          />
          <Slider
            tooltip={{ open: false }}
            className="range-container"
            trackStyle={{ background: '#999', height: '0' }}
            railStyle={{
              background: '#999',
              width: '0',
              height: '0',
              borderLeft: '150px solid #1C2025',
              borderBottom: '14px solid #999',
            }}
            value={sliderValue}
            onChange={handleSliderChange}
            step={25}
          />
          <Button
            type="text"
            className="more"
            icon={<AiOutlinePlus color="#89c4f4" size={20} />}
            onClick={handlePlus}
          />
        </div>
      </div>
    </>
  );
};

export default Timeline;
