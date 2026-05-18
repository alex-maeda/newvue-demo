import { Bar, BarConfig } from '@ant-design/plots';

import { chartModalityData } from '../utils';
import { useAppSelector } from '../../../hooks/hooks';

const RVUModality = () => {
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  const config: BarConfig = {
    data: chartModalityData,
    xField: 'value',
    yField: 'type',
    autoFit: true,
    // sort: {
    //   reverse: true,
    // },
    xAxis: {
      grid: {
        line: {
          style: {
            lineWidth: 0,
            stroke: 'transparent',
          },
        },
      },
      line: {
        style: {
          stroke: '#ccc',
        },
      },
      label: {
        formatter: (text, item) => {
          const value = item.value;

          if (value === 0 || value === 1) {
            return `${text}%`;
          }
          return '';
        },
        style: {
          fill: isKonicaBranding ? '#a6daef' : '#A1D103',
        },
      },
      // style: {
      //   fill: '#A1D103',
      // },
      tickLine: {
        style: {
          stroke: 'transparent',
        },
      },
      max: 100,
    },
    yAxis: {
      label: {
        style: {
          fill: isKonicaBranding ? '#a6daef' : '#A1D103',
        },
      },
      tickLine: {
        style: {
          stroke: 'transparent',
        },
      },
    },
    label: {
      position: 'right',
      formatter: (data) => (data.value !== 0 ? `${data.value}%` : ''),
      style: {
        fill: isKonicaBranding ? '#a6daef' : '#A1D103',
      },
    },
    tooltip: {
      formatter: (data) => ({
        name: 'Percent',
        value: `${data.value}%`,
      }),
    },
    color: isKonicaBranding ? '#a6daef' : '#A1D103',
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Bar {...config} />
    </div>
  );
};

export default RVUModality;
