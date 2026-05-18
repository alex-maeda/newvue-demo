import React, { FC } from 'react';
import { Line } from '@ant-design/plots';

import { chartHourData } from '../utils';
import { useAppSelector } from '../../../hooks/hooks';

const RVUHour: FC = () => {
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  function selectNthElements<T>(arr: T[], numPoints: number): T[] {
    const step = (arr.length - 2) / (numPoints - 2);
    return Array.from(
      { length: numPoints },
      (_, i) => arr[Math.floor(i * step)],
    );
  }

  const pointLimit = 15;
  const reducedData = selectNthElements(chartHourData, pointLimit);

  const config = {
    data: reducedData,
    xField: 'hour',
    yField: 'value',
    autoFit: true,
    xAxis: {
      label: {
        style: {
          linrHeight: 24,
        },
      },
      tickLine: {
        style: { stroke: 'white', strokeOpacity: 0.05 },
      },
      line: {
        style: {
          stroke: 'white',
          lineWidth: 1,
          strokeOpacity: 0.05,
          opacity: 0.05,
        },
      },
      grid: {
        line: {
          style: {
            stroke: 'white',
            lineWidth: 1,
            strokeOpacity: 0.05,
          },
        },
      },
    },
    yAxis: {
      grid: {
        line: {
          style: {
            stroke: 'white',
            lineWidth: 1,
            strokeOpacity: 0.05,
          },
        },
      },
      max: chartHourData.reduce((acc, item) => acc + item.value, 0) / 2,
    },
    point: {
      size: 5,
      shape: 'custom-point',
      style: {
        fill: isKonicaBranding ? '#0068b4' : '#8A85FF',
        // stroke: '#8A85FF',
        // lineWidth: 2,
        // lineOpacity: 1,
      },
    },
    label: {
      offsetY: -5,
      style: {
        fill: 'rgba(255, 255, 255, 0.85)',
        fontSize: 12,
        fontWeight: '500',
      },
    },
    lineStyle: {
      stroke: isKonicaBranding ? '#0068b4' : '#8A85FF',
      lineWidth: 2,
      cursor: 'pointer',
    },
    tooltip: {
      showMarkers: false,
    },
    interactions: [
      {
        type: 'marker-active',
      },
    ],
  };
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Line renderer="svg" {...config} />
    </div>
  );
};

export default RVUHour;
