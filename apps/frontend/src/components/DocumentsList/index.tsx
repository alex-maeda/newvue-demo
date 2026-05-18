import { FC, useState, useMemo } from 'react';
import { IoMdClose } from 'react-icons/io';
import { Button, List } from 'antd';

import Panel from '../Panel';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import useDetectClickOutside from '../../hooks/useClickOutside';
import { resetDocumentListProps } from '../../redux/reducers/menuReducer';

import { data } from './utils';

import './style.scss';

const DocumentsList: FC = () => {
  const dispatch = useAppDispatch();
  const { documentListProps } = useAppSelector(({ menu }) => menu);
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);
  const [visitedLink, setVisitedLink] = useState<number[]>([]);

  const { x, y, info } = documentListProps || { info: {} };

  const handleCloseModal = () => {
    dispatch(resetDocumentListProps());
  };

  const modalRef = useDetectClickOutside(handleCloseModal);

  const handleVisit = (index: number) => {
    if (!visitedLink.includes(index)) {
      setVisitedLink((prev) => [...prev, index]);
    }
  };

  const docHeight = document.documentElement.clientHeight;

  const style = useMemo(() => {
    if (!x || !y) {
      return {};
    }

    const height = Math.floor(docHeight / 2);

    const result = {
      left: `${x}px`,
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

  if (!documentListProps || !x || !y) {
    return <></>;
  }

  return (
    <div ref={modalRef}>
      <Panel
        expanded
        className="document-modal"
        style={style}
        header={
          <>
            <div>
              <p>Documents for</p>
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
        <List
          itemLayout="horizontal"
          dataSource={data}
          renderItem={(item, index) => (
            <List.Item
              className={visitedLink.includes(index) ? 'visited' : ''}
              actions={[
                <a
                  key={1}
                  href={item.link}
                  download={false}
                  target="_blank"
                  className="document-awatar link"
                  rel="noopener noreferrer"
                  onClick={() => handleVisit(index)}
                />,
              ]}
            >
              <List.Item.Meta
                avatar={
                  <span
                    className={`document-awatar${
                      isKonicaBranding ? ' isKonicaBranding' : ''
                    } file`}
                  />
                }
                title={<p className="document-title">{item.title}</p>}
                description={
                  <div className="document-info">
                    <span>{item.date}</span>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Panel>
    </div>
  );
};

export default DocumentsList;
