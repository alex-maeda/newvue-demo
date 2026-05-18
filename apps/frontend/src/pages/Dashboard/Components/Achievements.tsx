import { FC } from 'react';
import { achieveConfig } from '../../../components/ProgressPanel/utils';
import { useAppSelector } from '../../../hooks/hooks';

const Achievements: FC = () => {
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  return (
    <div
      className={`achivements${isKonicaBranding ? ' isKonicaBranding' : ''}`}
    >
      {achieveConfig.map((item, index) => {
        const active = item.total === item.value;
        return (
          <div key={index}>
            <span className={`${item.icon} ${active ? 'active' : ''}`} />
            <div>
              <p>{item.title}</p>
              <p>
                <span className={`bold ${active ? 'sub-title-purple' : ''}`}>
                  {item.value}
                </span>
                <span className="bold sub-title-purple">/ {item.total}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default Achievements;
