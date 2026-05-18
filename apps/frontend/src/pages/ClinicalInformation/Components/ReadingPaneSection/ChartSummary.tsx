import { FC, useState } from 'react';
import Panel from '../../../../components/Panel';
import { ReactComponent as Hat } from '../../../../assets/img/hatPeerLearning.svg';
import { ERate } from '../../../../models/enums';
import { peerLearningState } from '../../../../redux/reducers/followUpReducer';
import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
const ChartSummary: FC<{
  handleShowRightPanelByHat: () => void;
}> = ({ handleShowRightPanelByHat }) => {
  const { openedPeerLearning } = useAppSelector(({ followUp }) => followUp);
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  const [rate, setRate] = useState<ERate>(ERate.NOT_RATE);
  const dispatch = useAppDispatch();

  const handleChangeActive = () => {
    dispatch(peerLearningState(!openedPeerLearning));
    handleShowRightPanelByHat();
  };

  const handleRate = (value: ERate) => {
    setRate((prevValue) => {
      if (
        (prevValue === ERate.LIKE && value === ERate.DISLIKE) ||
        (prevValue === ERate.DISLIKE && value === ERate.LIKE)
      ) {
        return value;
      }
      return prevValue === value ? ERate.NOT_RATE : value;
    });
  };

  return (
    <>
      {false && (
        <Panel
          className="chart-summary"
          header={
            <>
              <div className="title-icons">
                <Hat
                  onClick={handleChangeActive}
                  className={`hat ${openedPeerLearning ? 'active' : ''}`}
                />
                <div
                  className={`like-wrapper${
                    isKonicaBranding ? ' isKonicaBranding' : ''
                  }`}
                >
                  <span
                    className={`like-btn ${
                      rate === ERate.LIKE ? 'active' : ''
                    }`}
                    onClick={() => handleRate(ERate.LIKE)}
                  />
                  <span
                    className={`dislike-btn ${
                      rate === ERate.DISLIKE ? 'active' : ''
                    }`}
                    onClick={() => handleRate(ERate.DISLIKE)}
                  />
                </div>
              </div>
              <h1>Chart and AI Summary</h1>
            </>
          }
        >
          <div>
            <p>Chart and AI Summary content</p>
          </div>
        </Panel>
      )}
    </>
  );
};

export default ChartSummary;
