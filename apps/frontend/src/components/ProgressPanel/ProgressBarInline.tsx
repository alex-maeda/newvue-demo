import { FC, memo } from 'react';
import { Progress, Tooltip } from 'antd';
import { useAppSelector } from '../../hooks/hooks';

interface IConfigTooltip {
  title: string;
  class: string;
  value: number | string;
}

const ProgressBarInline: FC = () => {
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);
  const total = 100;
  const reports = 55;
  const consultation = 9;
  const followUps = 2;
  const teaching = 1;
  const peerLeaning = 1;
  const others = consultation + followUps + teaching + peerLeaning;

  const configTooltip: IConfigTooltip[] = [
    {
      title: 'Progress: ',
      class: 'normal',
      value: `${reports + others}/${total}`,
    },
    {
      title: 'Reports: ',
      class: 'reports',
      value: reports,
    },
    {
      title: 'Consultation: ',
      class: 'others',
      value: consultation,
    },
    {
      title: 'Follow-ups: ',
      class: 'others',
      value: followUps,
    },
    {
      title: 'Teaching: ',
      class: 'others',
      value: teaching,
    },
    {
      title: 'Peer Leaning: ',
      class: 'others',
      value: peerLeaning,
    },
  ];

  return (
    <Tooltip
      title={
        <ul>
          {configTooltip.map((i: IConfigTooltip, index: number) => (
            <li key={index} className={i.class}>
              <span>{i.title}</span>
              <strong>{i.value}</strong>
            </li>
          ))}
        </ul>
      }
      destroyTooltipOnHide={true}
    >
      <Progress
        className="ant-progress-inline"
        percent={reports + others}
        strokeColor={{
          '0%': isKonicaBranding ? '#009cbd' : '#A1D103',
          '100%': isKonicaBranding ? '#a6daef' : '#89c4f4',
        }}
        type="line"
      />
    </Tooltip>
  );
};

export default memo(ProgressBarInline);
