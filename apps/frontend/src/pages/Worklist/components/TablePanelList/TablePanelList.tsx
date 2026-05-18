import { FC, useCallback, useMemo } from 'react';

import PanelTable from '../TablePanel/TablePanel';

import {
  resetLinkedResult,
  resetSearchResult,
  setFiltersCombine,
  storeCheckedFilters,
} from '../../../../redux/reducers/filterReducer';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';

const TablePanelList: FC = () => {
  const dispatch = useAppDispatch();
  const {
    getPatients: { patients },
  } = useAppSelector(({ patients }) => patients);
  const { checkedFilters, filters, linkedFilterIds, searchQuery } =
    useAppSelector(({ filter }) => filter);

  const handleCloseSearchPanel = useCallback(() => {
    dispatch(resetSearchResult());
  }, []);

  const handleFilterCheck = useCallback(
    (value: string): void => {
      if (!checkedFilters) {
        return;
      }
      const filteredArray = checkedFilters.filter((i) => i.id !== value);
      dispatch(storeCheckedFilters(filteredArray));
    },
    [checkedFilters],
  );

  const handleCloseLinkedPanel = useCallback(() => {
    dispatch(resetLinkedResult());

    checkedFilters.map((item) => {
      if (item.isCombine) {
        dispatch(setFiltersCombine(item.id));
      }
    });
  }, [checkedFilters]);

  const filteredPatientsSearch = useMemo(() => {
    return patients.slice().filter((patient) => {
      return Object.values(patient).some((value) =>
        String(value).toLowerCase().includes(searchQuery),
      );
    });
  }, [patients, searchQuery]);

  const filteredPatientsCheckedFilters = useCallback(
    (searchParams: number) => {
      return patients.slice().filter((patient) => {
        return patient.sectionId.includes(searchParams);
      });
    },
    [patients],
  );

  const filteredPatientsLinked = useMemo(() => {
    return patients.slice().filter((patient) => {
      return (
        Array.isArray(linkedFilterIds) &&
        linkedFilterIds.some((param) => patient.sectionId.includes(param))
      );
    });
  }, [patients, linkedFilterIds]);

  return (
    <>
      {searchQuery && (
        <PanelTable
          filter={{
            id: String(filters.length + 1),
            label: `Search result for “${searchQuery}”`,
          }}
          searchParams={searchQuery}
          callback={handleCloseSearchPanel}
          dataArr={filteredPatientsSearch}
          style={{ marginBottom: !!checkedFilters.length ? '2px' : 0 }}
        />
      )}
      {checkedFilters
        .filter((item) => !item.isCombine)
        .map((filter, index) => (
          <PanelTable
            key={filter.id}
            filter={filter}
            searchParams={+filter.id}
            isNeedCollapse={!!searchQuery}
            callback={handleFilterCheck}
            dataArr={filteredPatientsCheckedFilters(+filter.id)}
            style={{
              marginBottom: checkedFilters.length === index + 1 ? 0 : '2px',
            }}
          />
        ))}
      {!!linkedFilterIds.length && (
        <PanelTable
          filter={{
            id: String(filters.length + searchQuery ? 2 : 1),
            label: 'Linked Worklist',
          }}
          searchParams={linkedFilterIds}
          callback={handleCloseLinkedPanel}
          dataArr={filteredPatientsLinked}
          style={{ marginBottom: 0 }}
        />
      )}
    </>
  );
};

export default TablePanelList;
