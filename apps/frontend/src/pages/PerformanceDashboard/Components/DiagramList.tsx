import { FC } from 'react';

import { ERadiologyTypeColor } from '../../../models/enums';

import { IGrowhChart } from '../types';

const DiagramList: FC<{ data: IGrowhChart[] }> = ({ data }) => {
  return (
    <div className="column-content">
      {data.map((item, index) => {
        const color = ERadiologyTypeColor[item.type];
        return (
          <div className="column" key={index}>
            <p>{item.type}</p>

            <div
              style={{
                height: `${item.value - (item?.opacityPercent ?? 0)}%`,
                backgroundColor: color,
              }}
              className="base-value"
            />
            <div
              style={{
                height: `${item?.opacityPercent ?? 0}%`,
                backgroundColor: color,
              }}
              className="opacity-value"
            />
          </div>
        );
      })}
    </div>
  );
};

export default DiagramList;
