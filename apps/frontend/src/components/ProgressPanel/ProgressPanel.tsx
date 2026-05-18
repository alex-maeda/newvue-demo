import { FC } from 'react';
import { Tooltip } from 'antd';

import Panel from '../Panel';
import ProgressBar from './ProgressBar';
import ProgressBarInline from './ProgressBarInline';

import { achieveConfig } from './utils';

import './style.scss';
import { useAppSelector } from '../../hooks/hooks';

// adding props
interface IProgressPanel {
  isShowProgressIcons?: boolean;
}

const ProgressPanel: FC<IProgressPanel> = ({ isShowProgressIcons = true }) => {
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  return (
    <Panel expanded className="progress-panel-wrapper">
      <div className="progress-panel">
        <div className={`content ${!isShowProgressIcons ? 'no-icons' : ''}`}>
          {isShowProgressIcons && (
            <div className="icons">
              {achieveConfig.map((item, index) => {
                const isActive = item.total === item.value;
                return (
                  <Tooltip
                    key={index}
                    placement="top"
                    trigger="hover"
                    title={item.title}
                    destroyTooltipOnHide={true}
                  >
                    <span
                      className={`${item.icon} ${
                        isActive && !isKonicaBranding
                          ? 'active'
                          : isActive && isKonicaBranding
                          ? 'activeKonicaBranding'
                          : ''
                      }`}
                    />
                  </Tooltip>
                );
              })}
            </div>
          )}
          <ProgressBar size={90} />
        </div>
        <div className="content-inline">
          <ProgressBarInline />
        </div>
      </div>
    </Panel>
  );
};

export default ProgressPanel;
