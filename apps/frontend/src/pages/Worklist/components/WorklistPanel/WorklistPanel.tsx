import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Input } from 'antd';
import { IoChevronDown, IoSearch } from 'react-icons/io5';
import { CheckboxValueType } from 'antd/es/checkbox/Group';

import EDPreliminaryPanel from '../../../../components/EDPreliminaryPanel';
import EDOverReadPanel from '../../../../components/EDOverReadPanel';
import ExamQualityFeedbackPanel from '../../../../components/ExamQualityFeedback';
import FindingDeliveryFeedbackPanel from '../../../../components/FindingDelivery';
import Panel from '../../../../components/Panel';
import Loader from '../../../../components/Loader';
import FilterCard from './FilterCard';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { getFiltersListThunk } from '../../../../redux/thunks/filterThunk';
import { setIsShowWorklistControllerBlock } from '../../../../redux/reducers/toolbarSettingsReducer';
import {
  getLinkedResult,
  getSearchResult,
  setFiltersCombine,
  setLastCheckedFilter,
  storeCheckedFilters,
} from '../../../../redux/reducers/filterReducer';
import {
  setHotKey,
  toggleIsExpandedSidebar,
} from '../../../../redux/reducers/utilsReducer';

import { ReactComponent as Gear } from '../../../../assets/img/gear.svg';

const CheckboxGroup = Checkbox.Group;

const WorklistComponent: FC = () => {
  const dispatch = useAppDispatch();
  const { filters, isFetching, checkedFilters, searchQuery } = useAppSelector(
    ({ filter }) => filter,
  );
  const { hotKey, isExpandedSidebar, isKonicaBranding } = useAppSelector(
    ({ utils }) => utils,
  );
  const {
    worklistController: { isShowControllerBlock },
  } = useAppSelector(({ toolbarSettings }) => toolbarSettings);
  const {
    openedPreliminary,
    openedEDOverRead,
    openedExamQualityFeedback,
    openedFindingsDeliveryFeedback,
  } = useAppSelector(({ followUp }) => followUp);
  const [value, setValue] = useState<string[]>([]);
  const [globalFilter, setGlobalFilter] = useState<string>(searchQuery);
  const searchInputRef = useRef<HTMLDivElement | null>(null);

  const handleFilterCheck = (values: string[]): void => {
    setValue(values);
    const checked = filters.filter((filter) =>
      values.some((val) => filter.id === val),
    );
    dispatch(storeCheckedFilters(checked));
  };

  useEffect(() => {
    dispatch(getFiltersListThunk());
  }, []);

  const handleShowRightPanel = useCallback(() => {
    dispatch(toggleIsExpandedSidebar());
  }, []);

  useEffect(() => {
    if (!hotKey) {
      return;
    }

    let index = -1;

    const keyIndex = hotKey.substring(2);

    switch (keyIndex) {
      case 'F':
        if (!isExpandedSidebar) {
          handleShowRightPanel();
        }
        if (searchInputRef.current) {
          const input = searchInputRef.current.querySelector('input');
          !!input && input.focus();
        }
        break;
      case 'M':
        index = value.indexOf('0');
        if (index < 0) {
          handleFilterCheck(['0', ...value]);
          dispatch(setLastCheckedFilter('0'));
        } else {
          const id = filters.findIndex((item) => item.id === '0');
          const newVal = [...value];
          newVal.splice(index, 1);
          handleFilterCheck(newVal);
          dispatch(setLastCheckedFilter(''));
          if (filters[id].isCombine) {
            dispatch(setFiltersCombine('0'));
            dispatch(getLinkedResult());
          }
        }
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        const id = +keyIndex - 1;
        if (id >= filters.length) {
          return;
        }

        const filterId = filters[id].id;

        index = value.indexOf(filterId);

        if (index === -1) {
          handleFilterCheck([filterId, ...value]);
          dispatch(setLastCheckedFilter(filterId));
        } else {
          const newVal = [...value];
          newVal.splice(index, 1);
          handleFilterCheck(newVal);
          dispatch(setLastCheckedFilter(''));
          if (filters[id].isCombine) {
            dispatch(setFiltersCombine(filterId));
            dispatch(getLinkedResult());
          }
        }
        break;
    }

    dispatch(setHotKey(''));
  }, [hotKey]);

  useEffect(() => {
    setValue(checkedFilters.map((filter) => filter.id));
  }, [checkedFilters]);

  const handleSearchChange = (val: string) => {
    setGlobalFilter(val);

    if (!val) {
      dispatch(getSearchResult(''));
    }
  };

  const handleSearch = () => {
    if (globalFilter.length >= 2) {
      dispatch(getSearchResult(globalFilter));
    }
  };

  const onClickSearchIcon = () => {
    handleShowRightPanel();
    if (searchInputRef.current) {
      const input = searchInputRef.current.querySelector('input');
      !!input && input.focus();
    }
  };

  const handleStateChangeControllerBlock = () => {
    dispatch(setIsShowWorklistControllerBlock(!isShowControllerBlock));
  };

  useEffect(() => {
    setGlobalFilter(searchQuery);
  }, [searchQuery]);

  return (
    <>
      {openedPreliminary ? (
        <EDPreliminaryPanel />
      ) : openedEDOverRead ? (
        <EDOverReadPanel />
      ) : openedExamQualityFeedback ? (
        <ExamQualityFeedbackPanel />
      ) : openedFindingsDeliveryFeedback ? (
        <FindingDeliveryFeedbackPanel />
      ) : (
        <Panel
          header={
            <>
              <div>
                <h1>Worklists</h1>
                <Button
                  shape="circle"
                  className="open-hide-right-panel-button"
                  icon={<IoChevronDown size={24} color="#282C34" />}
                  onClick={() => handleShowRightPanel()}
                />
              </div>
              <div
                className={`right-side-search-icon${
                  isKonicaBranding ? ' isKonicaBranding' : ''
                }`}
              >
                <span onClick={onClickSearchIcon} />
              </div>
              <div className="side-controller-block-icon">
                <Gear
                  className={isShowControllerBlock ? 'show' : ''}
                  onClick={handleStateChangeControllerBlock}
                />
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
          expanded
          className="workList"
        >
          {isFetching ? (
            <Loader />
          ) : (
            <CheckboxGroup
              value={value}
              onChange={(val: CheckboxValueType[]) =>
                handleFilterCheck(val as unknown as string[])
              }
              className="filter-list"
            >
              {filters?.map((filter, index) => (
                <FilterCard key={index} value={filter} index={index} />
              ))}
            </CheckboxGroup>
          )}
        </Panel>
      )}
    </>
  );
};

export default WorklistComponent;
