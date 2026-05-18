import React, { useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import {
  initializeSession,
  resetSession,
} from '../../redux/reducers/medicalReportReducer';
import { RADPAIR_URL } from '../../redux/reducers/radpairReducer';
import Loader from '../Loader';

import './style.scss';

const IFRAME_BASE_URL =
  process.env.REACT_APP_MEDICAL_REPORT_IFRAME_URL ||
  'https://main.dlz869gpeqvia.amplifyapp.com';

// Patient IDs that should use the new medical report iframe
const NEW_IFRAME_PATIENT_IDS = [1, 9, 52]; // Paula Everyly, Alberto Seels, Karen Johnson

enum IFRAME_PARENT_EVENT_TYPES {
  SIGN_IN_SUCCESSFUL = 'sign_in_successful',
  APP_READY = 'app_ready',
}

const RadPairEmbed: React.FC = () => {
  const dispatch = useAppDispatch();
  const {
    getPatient: { patient },
  } = useAppSelector(({ patients }) => patients);
  const {
    getPatientClinicalHistory: { currentExamination },
  } = useAppSelector(({ clinical }) => clinical);
  const { sessionId, isFetching } = useAppSelector(
    ({ medicalReport }) => medicalReport,
  );
  const { accessToken, createdReportId: reportId } = useAppSelector(
    ({ radpair }) => radpair,
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isSignInSuccessful, setSignInSuccessful] = useState(false);

  // Check if current patient should use new iframe
  const useNewIframe =
    patient?.id && NEW_IFRAME_PATIENT_IDS.includes(patient.id);

  // Initialize session for new iframe patients only when patient changes (not on timeline badge clicks)
  useEffect(() => {
    if (!useNewIframe || !patient) return;

    const getTemplateType = (examDescription: string): string => {
      const desc = examDescription.toLowerCase();
      if (
        desc.includes('head') &&
        (desc.includes('w/wo') ||
          desc.includes('contrast') ||
          desc.includes('mr'))
      ) {
        return 'MR_HEAD';
      }
      if (
        desc.includes('chest') &&
        (desc.includes('2v') || desc.includes('xr') || desc.includes('x-ray'))
      ) {
        return 'XR_CHEST';
      }
      if (desc.includes('cervical') && desc.includes('spine')) {
        return 'CT_SPINE';
      }
      if (desc.includes('ct') && desc.includes('chest')) return 'CT_CHEST';
      if (desc.includes('ct') && desc.includes('head')) return 'CT_HEAD';
      if (desc.includes('mri') && desc.includes('brain')) return 'MRI_BRAIN';
      return 'CT_CHEST';
    };

    const patientName =
      patient.firstName && patient.lastName
        ? `${patient.firstName} ${patient.lastName}`
        : 'Unknown Patient';

    dispatch(
      initializeSession({
        patient_metadata: {
          patient_name: patientName,
          mrn: patient.MRN || patient.id?.toString() || 'Unknown',
          exam_description:
            currentExamination?.title ||
            patient.examDescription ||
            'Unknown Exam',
        },
        dictation_mode: 'generative',
        template_type: getTemplateType(
          currentExamination?.title || patient.examDescription || '',
        ),
      }),
    );
  }, [useNewIframe, patient, dispatch]);

  // RadPair message handling for old iframe patients
  const receiveMessage = (message: MessageEvent) => {
    if (message.origin !== new URL(RADPAIR_URL).origin) {
      return;
    }

    const event = message.data?.event;
    switch (event) {
      case IFRAME_PARENT_EVENT_TYPES.APP_READY:
        if (accessToken) {
          const iframe = iframeRef.current;
          if (iframe) {
            iframe.contentWindow?.postMessage(
              { authentication: `Bearer ${accessToken}` },
              RADPAIR_URL,
            );
          }
        }
        break;
      case IFRAME_PARENT_EVENT_TYPES.SIGN_IN_SUCCESSFUL:
        const iframe = iframeRef.current;
        if (iframe) {
          setSignInSuccessful(true);
          iframe.contentWindow?.postMessage({ headless: true }, RADPAIR_URL);
          iframe.contentWindow?.postMessage(
            {
              theme: {
                background: {
                  primary: '#1C2025',
                  dark: '#282C34',
                },
              },
            },
            RADPAIR_URL,
          );
        }
        break;
      default:
        console.log('Unknown event received from iframe:', event);
    }
  };

  useEffect(() => {
    if (!useNewIframe && iframeRef.current && isSignInSuccessful && reportId) {
      iframeRef.current.contentWindow?.postMessage(
        { report_id: reportId },
        RADPAIR_URL,
      );
    }
  }, [useNewIframe, isSignInSuccessful, reportId]);

  useEffect(() => {
    if (!useNewIframe && iframeRef.current) {
      window.addEventListener('message', receiveMessage);
    }
    return () => {
      window.removeEventListener('message', receiveMessage);
      if (useNewIframe) {
        dispatch(resetSession());
      }
    };
  }, [useNewIframe, dispatch]);

  // Render new iframe for specific patients
  if (useNewIframe) {
    const iframeUrl = sessionId
      ? `${IFRAME_BASE_URL}?session_id=${sessionId}`
      : IFRAME_BASE_URL;

    return (
      <div className="iframe-wrapper" id="medical-report-section">
        {isFetching ? (
          <Loader />
        ) : (
          <iframe
            ref={iframeRef}
            id="medical-report-iframe"
            src={iframeUrl}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '4px',
              border: 0,
            }}
            title="Medical Report UI"
            allow="microphone; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          ></iframe>
        )}
      </div>
    );
  }

  // Render old RadPair iframe for all other patients
  return (
    <div className="iframe-wrapper">
      <iframe
        ref={iframeRef}
        src={RADPAIR_URL}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="RADPAIR Embed"
        allow="microphone"
      ></iframe>
    </div>
  );
};

export default React.memo(RadPairEmbed);
