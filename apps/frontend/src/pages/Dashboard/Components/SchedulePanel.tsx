import { format } from 'date-fns';
import { FC } from 'react';
import Panel from '../../../components/Panel';
import { scheduledArrConfig } from '../utils';

const SchedulePanel: FC = () => {
  const today = new Date();
  const formattedDate = format(today, 'EEEE, MMMM do');

  return (
    <Panel
      expanded
      className="schedule-side-panel"
      header={
        <>
          <h1>Today’s Schedule</h1>
          <h2>{formattedDate}</h2>
        </>
      }
    >
      <div className="schedule">
        {scheduledArrConfig.map((item, index: number) => (
          <div key={index} className={item.status}>
            <strong>{item.title}</strong>
            <p>{item.time}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
};

export default SchedulePanel;
