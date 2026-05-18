import { FC, useEffect, useState, useRef, memo } from 'react';

import { ColorEnum } from '../../../models/enums';

import { addExpirationTimerAlert } from '../../../redux/reducers/chatReducer';

import { useAppDispatch } from '../../../hooks/hooks';
import {
  getDeltaTimeToNow,
  minutesToFormattedTime,
} from '../../../utils/DateUtils';
import { TIMER_RELOAD_TIME } from '../../../utils/GeneralUtil';

const TimerCell: FC<{
  value: number;
  id: number;
  color: ColorEnum | undefined;
  name: string | undefined;
  showOnly?: boolean;
}> = (props) => {
  const { value, id, name, color, showOnly } = props;
  const dispatch = useAppDispatch();
  const [seconds, setSeconds] = useState<number>(0);
  const intervalId = useRef<NodeJS.Timeout>();
  const isMsgSend = useRef(false);

  const { hoursString, minutesString } = minutesToFormattedTime(
    Math.abs(seconds),
  );

  useEffect(() => {
    return () => {
      clearInterval(intervalId.current);
    };
  }, []);

  useEffect(() => {
    if (seconds < 0 && !isMsgSend.current) {
      isMsgSend.current = true;
      dispatch(addExpirationTimerAlert({ id, name: name ?? '' }));
    }
  }, [seconds]);

  useEffect(() => {
    setSeconds(getDeltaTimeToNow(value));
    clearInterval(intervalId.current);

    if (showOnly) {
      return;
    }

    intervalId.current = setInterval(() => {
      setSeconds(getDeltaTimeToNow(value));
    }, TIMER_RELOAD_TIME);
  }, [value]);

  return (
    <div className={`timer ${color}`}>
      {hoursString} {minutesString}
    </div>
  );
};

const TimerCellMemo = memo(TimerCell, (prevProps, nextProps) => {
  return prevProps.value === nextProps.value;
});

export default TimerCellMemo;
