import { FC } from 'react';
import { TExamHistory } from '../../../redux/types/followUpTypes';

const ReportTextExamBody: FC<{
  data: TExamHistory;
  active: number | undefined;
}> = ({ data, active }) => {
  const dataReport = data.data as { reportText: string };
  return (
    <div id="section1" className={active === 1 ? 'active' : ''}>
      <h2>Report Text:</h2>
      <div>
        <p>{dataReport.reportText}</p>
      </div>
    </div>
  );
};

export default ReportTextExamBody;
