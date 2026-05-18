import { FC } from 'react';

import './style.scss';

const Loader: FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={`${className || ''} loader-wrapper`}>
      <span className="ant-spin-dot ant-spin-dot-spin">
        <i className="ant-spin-dot-item" />
        <i className="ant-spin-dot-item" />
        <i className="ant-spin-dot-item" />
        <i className="ant-spin-dot-item" />
      </span>
      <span className="loader-content">Loading</span>
    </div>
  );
};

export default Loader;
