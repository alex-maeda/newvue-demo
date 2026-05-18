import { FC, useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Button, Input, List, Tooltip } from 'antd';
import { AiFillInfoCircle, AiOutlinePlus } from 'react-icons/ai';
import { IoChevronDown, IoSearch } from 'react-icons/io5';
import { useParams } from 'react-router-dom';

import { EConsiderationItemName } from '../../../models/enums';
import { TConsideration } from '../../../models/Consideration';

import { getSearchClinicalResult } from '../../../redux/reducers/filterReducer';
import { toggleIsExpandedSidebar } from '../../../redux/reducers/utilsReducer';

import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';

import Panel from '../../../components/Panel';
import Loader from '../../../components/Loader';

import { considerationsList } from '../utils';

const ClinicalConsideration: FC = () => {
  const {
    getConsideration: { considerations, isFetching },
  } = useAppSelector(({ clinical }) => clinical);
  const {
    getPatient: { patient, isFetching: isFetchingGetPatient },
  } = useAppSelector(({ patients }) => patients);
  const { searchClinicalQuery } = useAppSelector(({ filter }) => filter);
  const [globalFilter, setGlobalFilter] = useState<string>(searchClinicalQuery);
  const dispatch = useAppDispatch();
  const { patientId } = useParams();

  const searchInputRef = useRef<HTMLDivElement | null>(null);

  const handleShowRightPanel = useCallback(() => {
    dispatch(toggleIsExpandedSidebar());
  }, []);

  const onClickSearchIcon = () => {
    handleShowRightPanel();
    if (searchInputRef.current) {
      const input = searchInputRef.current.querySelector('input');
      !!input && input.focus();
    }
  };

  const handleSearchChange = (val: string) => {
    setGlobalFilter(val);

    if (!val) {
      dispatch(getSearchClinicalResult(''));
    }
  };

  const handleSearch = () => {
    if (globalFilter.length >= 2) {
      dispatch(getSearchClinicalResult(globalFilter));
    }
  };

  const considerationsForPatient: TConsideration | null = useMemo(
    () => (considerations && patientId ? considerations[patientId] : null),
    [patientId, considerations],
  );

  useEffect(() => {
    setGlobalFilter(searchClinicalQuery);
  }, [searchClinicalQuery]);

  return (
    <Panel
      expanded
      className="clinic-consideration"
      header={
        <>
          <div>
            <div>
              {!!Object.values(patient).length && patientId && (
                <h1>Clinical Considerations</h1>
              )}
            </div>
            <Button
              shape="circle"
              className="open-hide-right-panel-button"
              icon={<IoChevronDown size={24} color="#282C34" />}
              onClick={() => handleShowRightPanel()}
            />
          </div>
          <div className="right-side-search-icon">
            <span onClick={onClickSearchIcon} />
          </div>
          <div className="input-group search" ref={searchInputRef}>
            <Input
              id="search"
              type="text"
              value={globalFilter}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search"
              onPressEnter={handleSearch}
            />
            <Button icon={<IoSearch size={20} onClick={handleSearch} />} />
          </div>
        </>
      }
    >
      {patientId ? (
        <>
          {isFetching || isFetchingGetPatient ? (
            <Loader />
          ) : !!Object.values(patient).length && considerationsForPatient ? (
            <List
              itemLayout="vertical"
              dataSource={considerationsList}
              renderItem={(item) => (
                <List.Item key={item.id}>
                  <h2>{item.title}</h2>
                  {item.id !== EConsiderationItemName.REFERENCES
                    ? considerationsForPatient[
                        item.id as keyof TConsideration
                      ]?.map((considerItem, index) => (
                        <Button
                          className="consider-item"
                          key={index}
                          type="primary"
                          icon={<AiOutlinePlus />}
                        >
                          <p>{considerItem.title}</p>
                          <Tooltip
                            autoAdjustOverflow
                            placement="top"
                            trigger="hover"
                            title={
                              <Tooltip
                                arrow={false}
                                destroyTooltipOnHide={true}
                              >
                                {considerItem.info}
                              </Tooltip>
                            }
                            destroyTooltipOnHide={true}
                          >
                            <AiFillInfoCircle />
                          </Tooltip>
                        </Button>
                      ))
                    : considerationsForPatient[
                        item.id as keyof TConsideration
                      ]?.map((item, index) => <p key={index}>{item.info}</p>)}
                </List.Item>
              )}
            />
          ) : (
            <></>
          )}
        </>
      ) : (
        <></>
      )}
    </Panel>
  );
};

export default ClinicalConsideration;
