import { FC } from 'react';
import Panel from '../../../components/Panel';
import { insightDailyConfig } from '../utils';
import { IInsightDailyConfig } from '../types';

const InsightDaily: FC = () => {
  return (
    <Panel expanded className="insight-daily">
      <div className="insight-daily-content">
        {insightDailyConfig.map((item: IInsightDailyConfig, index: number) => (
          <div
            style={{ width: `calc(100% / ${insightDailyConfig.length})` }}
            key={index}
          >
            <span className={item.icon} />
            <p>{item.title}</p>
            <strong>{item.value}</strong>
            <span className="separate-dash" />
          </div>
        ))}
      </div>
    </Panel>
  );
};

export default InsightDaily;
