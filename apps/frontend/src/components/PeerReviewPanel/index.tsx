import { FC, useCallback, useState } from 'react';
import TextArea from 'antd/es/input/TextArea';
import { IoChevronDown, IoArrowBackOutline } from 'react-icons/io5';
import { Button, Radio, Space } from 'antd';
import type { RadioChangeEvent } from 'antd';

import { ENotificationsType } from '../../models/enums';
import { TPeerReviewSaved } from '../../models/PeerReview';

import Panel from '../Panel';
import Loader from '../Loader';

import {
  completePeerReview,
  closePeerReview,
  sendFinalScore,
} from '../../redux/reducers/followUpReducer';
import { addNotificationAlert } from '../../redux/reducers/chatReducer';
import { toggleIsExpandedSidebar } from '../../redux/reducers/utilsReducer';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';

import { ClinicalInfoUrl } from '../../UrlsConfig';

import {
  peerReviewQuestions,
  peerReviewQuestionsSecondBlock,
  questionsConfigYesOrNo,
} from '../../utils/QuestionUtils';

import './style.scss';

const PeerReviewPanel: FC<{
  isFinal?: boolean;
  hided?: boolean;
}> = ({ isFinal = false, hided }) => {
  const [selected, setSelected] = useState<number>(1);
  const [subSelected, setSubSelected] = useState<'A' | 'B' | ''>('');
  const [isRequired, setIsRequired] = useState<string>('Yes');

  const [comment, setComment] = useState('');
  const dispatch = useAppDispatch();

  const { isFetching } = useAppSelector(({ followUp }) => followUp);
  const { user } = useAppSelector(({ auth }) => auth);

  const onChange = (e: RadioChangeEvent) => {
    const { value } = e.target;
    setSelected(value);

    if (value !== 1) {
      setSubSelected(value === 2 ? 'A' : 'B');
    } else {
      setSubSelected('');
    }
  };

  const onSubmit = () => {
    if (!selected || (isFinal && !isRequired)) {
      return;
    }

    const peerItem = peerReviewQuestions.find((i) => i.score === selected);
    const subPeerItem = peerReviewQuestionsSecondBlock.find(
      (i) => i.score === subSelected,
    );

    const prepareData: TPeerReviewSaved = {
      score: String(selected),
      meaning: peerItem?.meaning || '',
      subOption: subSelected && `${subSelected} - ${subPeerItem?.meaning}`,
      comment,
      isRequired: isFinal && selected > 1 ? isRequired : undefined,
      reviewer: `${user?.firstName} ${user?.lastName}`,
    };

    if (isFinal) {
      dispatch(sendFinalScore(prepareData));
      dispatch(
        addNotificationAlert({
          title: 'Final score submitted successfully',
          description: 'Thank you! Your final score has been submitted.',
          type: ENotificationsType.SUCCESS,
        }),
      );
    } else {
      dispatch(completePeerReview(prepareData));

      dispatch(
        addNotificationAlert({
          title: 'Peer review submitted successfully',
          description: 'Thank you! Your peer review has been submitted.',
          type: ENotificationsType.SUCCESS,
        }),
      );
    }
    goBack();
  };

  const handleReset = () => {
    setSelected(1);
    setSubSelected('');
    setComment('');
  };

  const goBack = () => {
    if (window.location.href.includes(ClinicalInfoUrl)) {
      dispatch(closePeerReview());
    } else {
      handleReset();
    }
  };

  const handleShowRightPanel = useCallback(() => {
    dispatch(toggleIsExpandedSidebar());
  }, []);

  return (
    <Panel
      expanded
      className="peer-review"
      header={
        <div>
          {!isFinal && (
            <Button
              type="link"
              className="go-back-button"
              icon={<IoArrowBackOutline size={24} color="#999" />}
              onClick={goBack}
            />
          )}
          <h1>{isFinal ? 'Final Score' : 'Peer Review'}</h1>
          <Button
            shape="circle"
            className="open-hide-right-panel-button"
            icon={<IoChevronDown size={24} color="#282C34" />}
            onClick={() => handleShowRightPanel()}
          />
        </div>
      }
    >
      {isFetching ? (
        <Loader />
      ) : hided ? (
        <></>
      ) : (
        <>
          <div>
            <div>
              <h2>
                {isFinal
                  ? 'Please select a final score for the review'
                  : 'Do you concur with the interpretation?'}
              </h2>
              <Radio.Group
                className="radio-group-wrapper"
                onChange={onChange}
                value={selected}
              >
                <Space direction="vertical">
                  {peerReviewQuestions.map((data) => (
                    <div
                      key={data.score}
                      className={`radio-wrapper ${
                        selected === data.score ? 'active' : ''
                      }`}
                    >
                      <Radio value={data.score} id={`review${data.score}`}>
                        <strong>{data.score}</strong>
                        <span>{data.meaning}</span>
                      </Radio>
                    </div>
                  ))}
                </Space>
              </Radio.Group>
            </div>

            {subSelected && (
              <div>
                <h2>Is the discrepancy clinically significant?</h2>
                <Radio.Group
                  className="radio-group-wrapper"
                  onChange={(e) => setSubSelected(e.target.value)}
                  value={subSelected}
                >
                  <Space direction="vertical">
                    {peerReviewQuestionsSecondBlock.map((item, index) => (
                      <div
                        key={index}
                        className={`radio-wrapper ${
                          subSelected === item.score ? 'active' : ''
                        }`}
                      >
                        <Radio value={item.score} id={`subOption${item.score}`}>
                          <strong>{item.score}</strong>
                          <span>{item.meaning}</span>
                        </Radio>
                      </div>
                    ))}
                  </Space>
                </Radio.Group>
              </div>
            )}

            {isFinal && (
              <div>
                <h2> Is an addendum required?</h2>
                <Radio.Group
                  className="radio-group-wrapper"
                  onChange={(e) => setIsRequired(e.target.value)}
                  value={isRequired}
                >
                  <Space direction="vertical">
                    {questionsConfigYesOrNo.map((data) => (
                      <div
                        key={data.score}
                        className={`radio-wrapper ${
                          isRequired === data.meaning ? 'active' : ''
                        }`}
                      >
                        <Radio
                          value={data.meaning}
                          id={`addendum${data.meaning}`}
                        >
                          <span>{data.meaning}</span>
                        </Radio>
                      </div>
                    ))}
                  </Space>
                </Radio.Group>
              </div>
            )}
          </div>

          <div>
            <div className="comments-area">
              <h2>Comments</h2>
              <TextArea
                name="textarea-comment"
                id="comment"
                placeholder="Text comment here"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 5 }}
                maxLength={500}
              />
            </div>

            <Space className="button-wrapper">
              <Button onClick={goBack} className="cancel">
                Cancel
              </Button>
              <Button onClick={onSubmit} className="submit">
                Submit
              </Button>
            </Space>
          </div>
        </>
      )}
    </Panel>
  );
};

export default PeerReviewPanel;
