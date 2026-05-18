import React, { useEffect, useRef } from 'react';
import { reportId } from './const/reportIds';
import { useAppSelector } from '../../hooks/hooks';
import './style.scss';

const IFRAME_URL = 'https://ambient-poc.demo.smart-reporting.com/';
const TOKEN =
  'eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwidXNlckZpcnN0TmFtZSI6IkhhbnMiLCJ1c2VyTGFzdE5hbWUiOiJNdWxsZXIiLCJpc3MiOiIiLCJhdWQiOiIiLCJwZXJtaXNzaW9ucyI6WyJjbGluaWNhbEFkbWluQWNjZXNzIiwidGVjaG5pY2FsQWRtaW5BY2Nlc3MiLCJzeXN0ZW1UZWNobmljYWxBZG1pbiIsImNyZWF0ZVJlcG9ydCIsIm9wZW5SZXBvcnQiLCJzaWduUmVwb3J0IiwiZGlzdHJpYnV0ZVJlcG9ydCIsImFkZGVuZFJlcG9ydCIsInByZWxpbVJlcG9ydCJdLCJleHAiOjE4OTM1ODE1OTB9.leeS1zHZuwy1XVC9QaRhlL5w01apvfKDUrgpjF1XJGUkbZm8wbVpvCg-sv8pfm-ZoLpLYwqUqoBOgc6IX_K_V9wkskU_pFRJfHcnJTk54ixRtf4Ymf3lS6VTU0nn27OsizJiwJ6mUPCha5zkhj0gaXhrwOZ8nEWFhLyPxU6KllxGBPrT2LQgSTc5UIXAg3NAEJfCk_6EpAx5En3Yl7QkjrKo8TVpLE1wDKI1DrY7S8NWePDOnKvXqUBCjL0aAK8H1CXZCeTwhmU6z1R5djVhhXrwwiQcVZKKB-QhNx2wtQGDxb6tyye3fYlJRtVsyuF2-NPB3y6WLGakASswgJEACQ';

const SmartReportingEmbed: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const {
    getPatient: { patient },
  } = useAppSelector(({ patients }) => patients);

  useEffect(() => {
    handleIframeLoad();
  }, [patient]);

  const handleIframeLoad = () => {
    if (!iframeRef.current) return;

    iframeRef.current.contentWindow?.postMessage(
      {
        type: 'openReport',
        token: TOKEN,
        requestId: crypto.randomUUID(),
        reportId: reportId[patient.MRN] ?? 'tt-00000',
      },
      '*',
    );
  };

  return (
    <div className="iframe-wrapper">
      <iframe
        src={IFRAME_URL}
        ref={iframeRef}
        style={{ width: '100%', height: '100%' }}
        title="SmartReporting Embed"
        allow="microphone" // This line allows microphone access
      ></iframe>
    </div>
  );
};

export default React.memo(SmartReportingEmbed);
