import {
  FC,
  useMemo,
  useRef,
  MouseEvent,
  SyntheticEvent,
  useCallback,
} from 'react';
import { Link } from 'react-router-dom';
import { Tooltip } from 'antd';

import InfoMenuCell from './InfoMenuCell';

import { IPatient } from '../../../models/Patient';
import { ENoteType, EPatientMode } from '../../../models/enums';

import {
  setDocumentListProps,
  setNoteProps,
} from '../../../redux/reducers/menuReducer';
import {
  preliminaryEDOverReadState,
  preliminaryState,
} from '../../../redux/reducers/followUpReducer';

import { ClinicalInfoUrl, WorklistUrl } from '../../../UrlsConfig';
import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';
import {
  PATIENT_LINK_READ_AI,
  getPatientLink,
} from '../../../utils/GeneralUtil';
import {
  resetSearchClinicalResult,
  setCurrentFilterId,
} from '../../../redux/reducers/filterReducer';
import { changePatientMode } from '../../../redux/reducers/patientReducer';
import { setIsExpandChatArea } from '../../../redux/reducers/utilsReducer';
import { useWindowContext } from '../../../contexts/WindowContext';

const AvailableActions: FC<{
  info: IPatient;
  sectionId?: number;
  showLink?: boolean;
  disableActions?: boolean;
}> = (props) => {
  const { info, sectionId, showLink = true, disableActions = false } = props;
  const dispatch = useAppDispatch();
  const cellRef = useRef<HTMLDivElement>(null);
  const { openWindow } = useWindowContext();
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  const linkView = useMemo(() => {
    if (info.id === 12) {
      return WorklistUrl;
    }
    return `${ClinicalInfoUrl}/${info.id}?viewOnly=true`;
  }, [info.id]);

  const handleGoToViewPatient = (e: SyntheticEvent) => {
    if (disableActions) {
      return;
    }

    // If ED Preliminary is enabled, open the panel instead of navigating
    if (info.isEdPreliminaryEnabled) {
      e.preventDefault();
      dispatch(preliminaryState(true));
      return;
    }

    // Code under open new separate window with client info
    const windowFeatures = 'left=50,top=50,width=1000,height=800';
    if (info.id === 12) {
      window.open(PATIENT_LINK_READ_AI, 'newWindow1', windowFeatures);
      return;
    } else {
      openWindow(
        getPatientLink(info.MRN, String(info.accession), info.patientLink),
      );
    }

    if (info.id > 12) {
      e.preventDefault();
      return;
    }

    if (sectionId) {
      dispatch(setCurrentFilterId(sectionId));
    }

    dispatch(resetSearchClinicalResult());
    dispatch(changePatientMode({ id: info.id, mode: EPatientMode.VIEW }));
    dispatch(setIsExpandChatArea(false));
  };

  // const handleFile = (e: MouseEvent) => {
  //   e.stopPropagation();
  //   e.preventDefault();

  //   if (!cellRef.current || disableActions) {
  //     return;
  //   }

  //   const { bottom, right } = cellRef.current.getBoundingClientRect();

  //   dispatch(
  //     setDocumentListProps({
  //       x: right,
  //       y: bottom,
  //       info,
  //     }),
  //   );
  // };

  const handleFile = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!cellRef.current || disableActions) {
      return;
    }

    const { bottom, right } = cellRef.current.getBoundingClientRect();

    dispatch(
      setDocumentListProps({
        x: right,
        y: bottom,
        info,
      }),
    );
  }, []);

  // const handleNote = (e: MouseEvent, type: ENoteType) => {
  //   e.stopPropagation();

  //   if (!cellRef.current || disableActions) {
  //     return;
  //   }

  //   const { bottom, right } = cellRef.current.getBoundingClientRect();

  //   dispatch(
  //     setNoteProps({
  //       x: right,
  //       y: bottom,
  //       info,
  //       type,
  //     }),
  //   );
  // };

  const handleNote = useCallback((e: MouseEvent, type: ENoteType) => {
    e.stopPropagation();
    e.preventDefault();

    if (type === 'AI') return;

    if (!cellRef.current || disableActions) {
      return;
    }

    const { bottom, right } = cellRef.current.getBoundingClientRect();

    dispatch(
      setNoteProps({
        x: right,
        y: bottom,
        info,
        type,
      }),
    );
  }, []);

  return (
    <>
      <div className="actions" ref={cellRef}>
        {showLink && (
          <Tooltip
            placement="top"
            trigger="hover"
            title={<p>View</p>}
            destroyTooltipOnHide={true}
          >
            <span
              className={`custom-btn-table${
                isKonicaBranding ? ' isKonicaBranding' : ''
              } link`}
              data-icon="table-button-icon"
            >
              <Link
                to={linkView}
                rel="noreferrer"
                // target="_blank"
                onClick={(e) => handleGoToViewPatient(e)}
              />
            </span>
          </Tooltip>
        )}
        {info.patientsNote &&
          info.patientsNote.map((item, index) => (
            <Tooltip
              key={index}
              placement="top"
              trigger="hover"
              title={
                <p className="noteAI-tooltip-text">
                  {item.type === ENoteType.ER
                    ? 'Prelims/Notes'
                    : info.id === 2
                    ? 'Viz.ai: Suspected Positive LVO'
                    : info.id === 45
                    ? 'Suspected  positive for spinal cord compression'
                    : info.id === 41
                    ? 'Vis.ai: Suspected negative for LVO'
                    : 'Suspected negative for lung nodules'}
                </p>
              }
              destroyTooltipOnHide={true}
            >
              <span
                className={`custom-btn-table ${
                  item.type === ENoteType.ER ? 'noteER' : 'noteAI'
                } ${info.id === 2 || info.id === 45 ? 'noteAI-alert' : ''}`}
                data-icon="table-button-icon"
                onClick={(e) => handleNote(e, item.type)}
              />
            </Tooltip>
          ))}
        {info.isEdPreliminaryEnabled && (
          <Tooltip
            placement="top"
            trigger="hover"
            title={<p>ED Over-read</p>}
            destroyTooltipOnHide={true}
          >
            <span
              className={`custom-btn-table${
                isKonicaBranding ? ' isKonicaBranding' : ''
              } noteER active`}
              onClick={() => dispatch(preliminaryEDOverReadState(true))}
            />
          </Tooltip>
        )}
        <Tooltip
          placement="top"
          trigger="hover"
          title={<p>Exam Documents</p>}
          destroyTooltipOnHide={true}
        >
          <span
            className={`custom-btn-table${
              isKonicaBranding ? ' isKonicaBranding' : ''
            } file`}
            data-icon="table-button-icon"
            onClick={handleFile}
          />
        </Tooltip>
        <InfoMenuCell info={info} disable={disableActions} />
      </div>
    </>
  );
};

export default AvailableActions;
