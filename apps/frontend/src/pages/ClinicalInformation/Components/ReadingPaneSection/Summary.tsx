import { FC, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { setCurrentExamination } from '../../../../redux/reducers/clinicalReducer';
import { EExaminations } from '../../../../models/enums';
import { formateDate } from '../../../../utils/DateUtils';
import {
  TSummaryData,
  TRadiologyDecision,
  TProblemDecision,
} from '../../../../models/Consideration';
import DataTableModal, { TableColumn } from './DataTableModal';
import Modal from './Modal';

const Summary: FC = () => {
  const dispatch = useAppDispatch();
  const provenanceRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [isRadiologyModalOpen, setIsRadiologyModalOpen] = useState(false);
  const [isProblemModalOpen, setIsProblemModalOpen] = useState(false);
  const [isStatedPurposeModalOpen, setIsStatedPurposeModalOpen] =
    useState(false);

  const {
    getPatientClinicalHistory: { data },
  } = useAppSelector(({ clinical }) => clinical);
  const { patientId } = useParams();

  const chartAndSummary = useMemo(
    () => data?.chartAndSummary || {},
    [data?.chartAndSummary],
  );

  const summaryData: TSummaryData | null = useMemo(() => {
    if (patientId && chartAndSummary[patientId]) {
      return chartAndSummary[patientId];
    }
    return null;
  }, [patientId, chartAndSummary]);

  const radiologyReports = useMemo(
    () => data?.radiologyReport || [],
    [data?.radiologyReport],
  );

  const radiologyDecisions = useMemo(() => {
    if (patientId && data?.radiologyDecisions?.[patientId]) {
      return data.radiologyDecisions[patientId];
    }
    return [];
  }, [patientId, data?.radiologyDecisions]);

  const problemDecisions = useMemo(() => {
    if (patientId && data?.problemDecisions?.[patientId]) {
      return data.problemDecisions[patientId];
    }
    return [];
  }, [patientId, data?.problemDecisions]);

  const statedPurpose = useMemo(() => {
    if (patientId && data?.statedPurpose?.[patientId]) {
      return data.statedPurpose[patientId];
    }
    return '';
  }, [patientId, data?.statedPurpose]);

  const radiologyColumns: TableColumn<TRadiologyDecision>[] = useMemo(
    () => [
      { header: 'Finding', accessor: 'finding' },
      { header: 'Region', accessor: 'region' },
      { header: 'Severity', accessor: 'severity' },
      { header: 'Trend', accessor: 'trend' },
      {
        header: 'Include',
        accessor: 'include',
        className: 'include-cell',
        render: (value) => ((value as boolean) ? '✓' : '✗'),
      },
      { header: 'Reason', accessor: 'reason' },
      { header: 'Sources', accessor: 'sources', className: 'sources-cell' },
    ],
    [],
  );

  const problemColumns: TableColumn<TProblemDecision>[] = useMemo(
    () => [
      { header: 'Problem', accessor: 'problem' },
      {
        header: 'Include',
        accessor: 'include',
        className: 'check-cell',
        render: (value) => ((value as boolean) ? '✓' : '✗'),
      },
      {
        header: 'Score',
        accessor: 'score',
        className: 'score-cell',
        render: (value) => (value as number).toFixed(2),
      },
      {
        header: 'Essential',
        accessor: 'essential',
        className: 'check-cell',
        render: (value) => ((value as boolean) ? '✓' : '✗'),
      },
      {
        header: 'Body Region',
        accessor: 'body_region',
        className: 'check-cell',
        render: (value) => ((value as boolean) ? '✓' : '✗'),
      },
      {
        header: 'Recent',
        accessor: 'recent',
        className: 'check-cell',
        render: (value) => ((value as boolean) ? '✓' : '✗'),
      },
      {
        header: 'Active',
        accessor: 'active',
        className: 'check-cell',
        render: (value) => ((value as boolean) ? '✓' : '✗'),
      },
      {
        header: 'Sources',
        accessor: 'sources',
        className: 'sources-cell',
        render: (value) => (value as string[]).join(', '),
      },
    ],
    [],
  );

  const handleTabClick = (tab: 'stated' | 'radiology' | 'problem') => {
    if (tab === 'stated') {
      setIsStatedPurposeModalOpen(true);
    } else if (tab === 'radiology') {
      setIsRadiologyModalOpen(true);
    } else if (tab === 'problem') {
      setIsProblemModalOpen(true);
    }
    // Don't set activeTab - none of the buttons should remain highlighted
  };

  const handleProvenanceClick = (reportId: number) => {
    const report = radiologyReports.find((r) => r.id === reportId);
    if (report) {
      dispatch(
        setCurrentExamination({
          ...report,
          type: EExaminations.RADIOLOGY,
        }),
      );
    }
  };

  const handleCitationClick = (reportId: number) => {
    const ref = provenanceRefs.current[reportId];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ref.classList.add('highlight');
      setTimeout(() => ref.classList.remove('highlight'), 2000);
    }
  };

  const renderTextWithCitations = (text: string, baseKey = '') => {
    // Split by both citations and bold markers
    const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*)/);
    return parts.map((part, index) => {
      // Check for citation
      const citationMatch = part.match(/\[(\d+)\]/);
      if (citationMatch) {
        const reportId = parseInt(citationMatch[1]);
        return (
          <span
            key={`${baseKey}-citation-${reportId}-${index}`}
            className="citation-link"
            onClick={() => handleCitationClick(reportId)}
          >
            {part}
          </span>
        );
      }
      // Check for bold text
      const boldMatch = part.match(/\*\*([^*]+)\*\*/);
      if (boldMatch) {
        return (
          <strong key={`${baseKey}-bold-${index}`} className="summary-bold">
            {boldMatch[1]}
          </strong>
        );
      }
      return <span key={`${baseKey}-text-${index}`}>{part}</span>;
    });
  };

  const renderProblemText = (text: string) => {
    // Find the first colon to split problem name from description
    const colonIndex = text.indexOf(':');
    if (colonIndex === -1) {
      return <span>{text}</span>;
    }

    const problemName = text.substring(0, colonIndex + 1); // Include the colon
    const description = text.substring(colonIndex + 1);

    return (
      <>
        <span className="summary-bold">{problemName}</span>
        {description}
      </>
    );
  };

  if (!summaryData) {
    return (
      <>
        <div className="title-item">
          <h1>Chart and AI Summary</h1>
        </div>
        <div className="text-view">
          <p>No summary available</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="text-view">
        <div className="summary-content">
          <div className="summary-header">
            <h3 className="summary-section-title">Purpose of Study</h3>
            <div className="summary-tabs">
              <button
                className="summary-tab"
                onClick={() => handleTabClick('stated')}
              >
                Stated Purpose
              </button>
              <button
                className="summary-tab"
                onClick={() => handleTabClick('radiology')}
              >
                Radiology Decisions
              </button>
              <button
                className="summary-tab"
                onClick={() => handleTabClick('problem')}
              >
                Problem Decisions
              </button>
            </div>
          </div>
          {summaryData.purposeOfStudy && (
            <>
              <p className="summary-text">
                <strong>Diagnostic:</strong> {summaryData.purposeOfStudy}
              </p>
              <hr />
            </>
          )}

          <h3 className="summary-section-title">Radiology Report Summary</h3>

          {summaryData.criticalFindings &&
            summaryData.criticalFindings.length > 0 && (
              <>
                <h4 className="summary-subsection-title">
                  Critical Prior Findings
                </h4>
                {summaryData.criticalFindings.map((finding, index) => (
                  <p key={`critical-${index}`} className="summary-bullet">
                    {renderTextWithCitations(finding, `critical-${index}`)}
                  </p>
                ))}
              </>
            )}

          {summaryData.higherPriority &&
            summaryData.higherPriority.length > 0 && (
              <>
                <h4 className="summary-subsection-title">Higher Priority</h4>
                {summaryData.higherPriority.map((item, index) => (
                  <p key={`higher-${index}`} className="summary-bullet">
                    {renderTextWithCitations(item, `higher-${index}`)}
                  </p>
                ))}
              </>
            )}

          {summaryData.lowerUrgency && summaryData.lowerUrgency.length > 0 && (
            <>
              <h4 className="summary-subsection-title">Lower Urgency</h4>
              {summaryData.lowerUrgency.map((item, index) => (
                <p key={`lower-${index}`} className="summary-bullet">
                  {renderTextWithCitations(item, `lower-${index}`)}
                </p>
              ))}
            </>
          )}

          <hr className="summary-separator" />
          {summaryData.provenanceReportIds &&
            summaryData.provenanceReportIds.length > 0 && (
              <>
                <h4 className="summary-subsection-title">Provenance</h4>
                <div className="provenance-list">
                  {summaryData.provenanceReportIds.map((reportId) => {
                    const report = radiologyReports.find(
                      (r) => r.id === reportId,
                    );
                    if (!report) return null;
                    return (
                      <div
                        key={reportId}
                        ref={(el) => (provenanceRefs.current[reportId] = el)}
                        className="provenance-item"
                      >
                        <span
                          className="provenance-link"
                          onClick={() => handleProvenanceClick(reportId)}
                        >
                          [{reportId}]: {report.title} —{' '}
                          {formateDate(report.date)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

          {summaryData.problemSummary &&
            summaryData.problemSummary.length > 0 && (
              <>
                <h3 className="summary-section-title">
                  Relevant Problem Summary
                </h3>
                {summaryData.problemSummary.map((problem, index) => (
                  <p key={index} className="summary-bullet">
                    {renderProblemText(problem)}
                  </p>
                ))}
              </>
            )}
        </div>
      </div>

      <Modal
        isOpen={isStatedPurposeModalOpen}
        onClose={() => setIsStatedPurposeModalOpen(false)}
        title="Study Purpose From Order Request"
      >
        <div className="nv-modal__content">
          {statedPurpose ||
            'bl strokes 2/2 hypercoaguable state from malignancy, with new somnolence, eval for evolving stroke or other etiologies'}
        </div>
      </Modal>

      <DataTableModal
        isOpen={isRadiologyModalOpen}
        onClose={() => setIsRadiologyModalOpen(false)}
        title="Radiology Decisions"
        data={radiologyDecisions}
        columns={radiologyColumns}
      />

      <DataTableModal
        isOpen={isProblemModalOpen}
        onClose={() => setIsProblemModalOpen(false)}
        title="Problem Decisions"
        data={problemDecisions}
        columns={problemColumns}
      />
    </>
  );
};

export default Summary;
