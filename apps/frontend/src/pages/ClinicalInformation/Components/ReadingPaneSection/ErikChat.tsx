import { FC } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAppSelector } from '../../../../hooks/hooks';
import './ErikChat.scss';

const ErikChat: FC = () => {
  const { question, answer, isLoading, error } = useAppSelector(
    ({ erik }) => erik,
  );
  return (
    <>
      <div id="erikChat" className="erik-chat">
        {question && <div className="erik-bubble erik-right">{question}</div>}
        {isLoading && !answer && !error && (
          <div className="erik-bubble erik-left">
            Processing your question...
          </div>
        )}
        {error && (
          <div className="erik-bubble erik-left">
            <p>
              I&apos;m having trouble processing your request right now. Please
              try again.
            </p>
          </div>
        )}
        {answer && !error && (
          <div className="erik-bubble erik-left erik-markdown">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </div>
        )}
        {!question && !answer && !error && (
          <div className="erik-empty-state">
            <p>Ask ERIK a question using the input above</p>
          </div>
        )}
      </div>
    </>
  );
};

export default ErikChat;
