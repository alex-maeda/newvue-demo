import { FC } from 'react';
import ProgressBar from '../../../components/ProgressPanel/ProgressBar';

const Recognition: FC = () => {
  return (
    <div className="recognition">
      <ProgressBar size={150} />
      <p>
        Today RVU Target: <strong>100</strong> RVU
      </p>
    </div>
  );
};

export default Recognition;
