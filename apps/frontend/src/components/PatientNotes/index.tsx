import { FC, useMemo } from 'react';
import { IoMdClose } from 'react-icons/io';
import { Button } from 'antd';

import Panel from '../Panel';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import useDetectClickOutside from '../../hooks/useClickOutside';
import { resetNoteProps } from '../../redux/reducers/menuReducer';

import { prepareDOB } from '../../utils/DateUtils';

import './style.scss';

const NoteList: FC = () => {
  const dispatch = useAppDispatch();
  const { noteProps } = useAppSelector(({ menu }) => menu);

  const { x, y, info, type } = noteProps || { info: {} };

  const handleCloseModal = () => {
    dispatch(resetNoteProps());
  };

  const modalRef = useDetectClickOutside(handleCloseModal);

  const docHeight = document.documentElement.clientHeight;

  const note = (info?.patientsNote ?? []).find((item) => item.type === type);

  const style = useMemo(() => {
    if (!x || !y) {
      return {};
    }

    const height = Math.floor(docHeight / 2);

    const result = {
      left: `${x}px`,
      height: `${height}px`,
      top: '',
      bottom: '',
    };

    if (y >= height) {
      result.bottom = `${docHeight - y}px`;
    } else {
      result.top = `${y}px`;
    }

    return result;
  }, [x, y, docHeight]);

  if (!noteProps || !x || !y) {
    return <></>;
  }

  return (
    <div ref={modalRef}>
      <Panel
        expanded
        className="note-modal"
        style={style}
        header={
          <>
            <div>
              <p>Notes for</p>
              <h2>{info?.name}</h2>
            </div>
            <Button
              type="text"
              shape="circle"
              className="header-icon"
              icon={<IoMdClose size={30} color="#999999" />}
              onClick={handleCloseModal}
            />
          </>
        }
      >
        <div className="physician-block">
          <p>
            <span>Physician:</span> {note?.physician}
          </p>
          <p>
            <span>Date:</span> {note?.DOB && prepareDOB(note?.DOB)}
          </p>
        </div>
        <div>
          <p>{note?.note}</p>
        </div>
      </Panel>
    </div>
  );
};

export default NoteList;
