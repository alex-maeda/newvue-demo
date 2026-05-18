import { useMemo, useState, FC } from 'react';
import {
  Row as TRow,
  SortingState,
  ColumnFiltersState,
  ColumnDef,
  CellContext,
} from '@tanstack/react-table';
import { Button, Space } from 'antd';
import { IoChevronDown } from 'react-icons/io5';
import { useNavigate, useParams } from 'react-router-dom';
// COMPONENTS
import TableComponent from '../../../components/Table';
import Loader from '../../../components/Loader';
// REDUX
import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';
import { getPatientThunk } from '../../../redux/thunks/patientThunk';
import { preparePatientData } from '../../../redux/reducers/patientReducer';
import { resetSearchClinicalResult } from '../../../redux/reducers/filterReducer';
// MODELS
import { IPatient } from '../../../models/Patient';

import { getColumns } from '../utils';
import { ClinicalInfoUrl } from '../../../UrlsConfig';
import { titleForStatus } from '../../Worklist/utils';
import { getNameByAccessor } from '../../../utils/TableUtil';
import { defaultSortFn, getPatientLink } from '../../../utils/GeneralUtil';
import { setIsExpandChatArea } from '../../../redux/reducers/utilsReducer';
import { useWindowContext } from '../../../contexts/WindowContext';

const ClinicalUpNextTable: FC<{
  handleChangeIsShowDetail: () => void;
  expanded: boolean;
}> = ({ handleChangeIsShowDetail, expanded }) => {
  const {
    getPatients: { patients, isFetching },
  } = useAppSelector(({ patients }) => patients);
  const {
    getColumnSetting: { columnSettings },
  } = useAppSelector(({ adminSettings }) => adminSettings);
  const { filters, currentFilterId } = useAppSelector(({ filter }) => filter);
  const dispatch = useAppDispatch();
  const navigator = useNavigate();
  const { patientId } = useParams();
  const { openWindow } = useWindowContext();
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'timer', desc: false },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const { dataMemo } = useMemo(() => {
    if (patients?.length) {
      const sortedPatients = patients
        .filter((i) => i.sectionId.includes(currentFilterId))
        .sort((a: IPatient, b: IPatient) => a.timer - b.timer);

      if (patientId) {
        const currentIndex = sortedPatients.findIndex(
          (patient: IPatient) => String(patient.id) === patientId,
        );

        sortedPatients.splice(currentIndex, 1);

        return {
          dataMemo: sortedPatients,
          nextPatient: sortedPatients[0] ? [sortedPatients[0]] : [],
        };
      }

      return { dataMemo: sortedPatients, nextPatient: [sortedPatients[0]] };
    }

    return { dataMemo: [], nextPatient: [] };
  }, [patientId, patients, currentFilterId]);

  const { priorities } = useMemo(
    () => preparePatientData(dataMemo, false),
    [dataMemo],
  );

  const columnSettingsMemo = useMemo(() => {
    if (currentFilterId && filters.length) {
      const foundFilter = filters.find(
        (filter) => +filter.id === currentFilterId,
      );
      if (foundFilter && foundFilter.settings?.columnSettings) {
        return foundFilter.settings?.columnSettings;
      }
    }
    return columnSettings;
  }, [columnSettings, filters, currentFilterId]);

  const redirect = (rowData: TRow<IPatient>) => {
    if (rowData && String(rowData.original.id) !== patientId) {
      dispatch(resetSearchClinicalResult());
      dispatch(getPatientThunk(String(rowData.original.id) ?? ''));
      navigator(`${ClinicalInfoUrl}/${rowData.original.id}?viewOnly=true`);
    }

    expanded &&
      setTimeout(() => {
        dispatch(setIsExpandChatArea(false));
      }, 0);
  };

  const handleRowClick = (rowData: TRow<IPatient>): void => {
    const { id, MRN, accession, patientLink } = rowData.original;

    // For Alberto Seels (ID: 9), also open the external Mach7 viewer in popup
    if (id === 9) {
      const viewerUrl = getPatientLink(MRN, String(accession), patientLink);
      openWindow(viewerUrl);
    }

    redirect(rowData);
  };

  const handleChangeExpand = () => {
    handleChangeIsShowDetail();
  };

  const generatedColumns = useMemo(() => {
    return columnSettingsMemo.map((item) => {
      const column: ColumnDef<IPatient> = {
        header: getNameByAccessor(item.accessor),
        id: item.accessor,
        accessorKey: item.accessor,
        enableSorting: true,
        enableColumnFilter: true,
        enablePinning: false,
        minSize: 50,
        size: 150,
        maxSize: 200,
        enableResizing: true,
        cell: (info: CellContext<IPatient, unknown>) =>
          (info.getValue() as string)?.toUpperCase(),
        meta: {
          order: item.order,
          disableTooltip: false,
        },
      };

      if (item.accessor === 'name') {
        column.sortingFn = (rowA, rowB) =>
          defaultSortFn(rowA.original.lastName, rowB.original.lastName);
      }

      return column;
    });
  }, [columnSettingsMemo]);

  const columnMemoForTable = useMemo(() => {
    return [...getColumns, ...generatedColumns];
  }, [getColumns, generatedColumns]);

  // useEffect(() => {
  //   if (!!searchClinicalQuery) {
  //     handleChangeIsShowDetail();
  //     setExpanded(false);
  //   }
  // }, [searchClinicalQuery]);

  return (
    <div
      className={`table-panel ${expanded ? 'expanded' : ''} ${
        isFetching && expanded ? 'loading' : ''
      }`}
      style={
        !expanded
          ? { paddingBottom: 0, marginBottom: 0, minHeight: 'auto' }
          : undefined
      }
    >
      <div className="panel-header">
        {isFetching && expanded ? (
          <div className="loader-wrapper" />
        ) : (
          <div className="panel-title wide-center stack">
            <div className="stack-item">
              <h1>Up Next</h1>
            </div>

            <Space className="stack-item">
              {priorities &&
                Object.entries(priorities).map(([color, count]) => (
                  <div className={`span-status ${color}`} key={color}>
                    <strong>{count}</strong>
                    <span>{titleForStatus[color]}</span>
                  </div>
                ))}
            </Space>
            <Button
              type="primary"
              shape="circle"
              className={`expand-header-icon ${
                expanded ? 'expand-icon' : 'collapse-icon'
              } `}
              icon={<IoChevronDown size={30} color="#282C34" />}
              onClick={handleChangeExpand}
            />
          </div>
        )}
      </div>
      {expanded && (
        <div className="panel-body">
          {isFetching ? (
            <div className="loader-wrapper">
              <Loader />
            </div>
          ) : (
            <div className="table-wrap double-table expanded">
              <TableComponent<IPatient>
                columns={columnMemoForTable}
                data={dataMemo}
                total={dataMemo.length}
                sorting={sorting}
                filters={columnFilters}
                handleRowClick={handleRowClick}
                onSortingChange={setSorting}
                onFilterChange={setColumnFilters}
                isDoubleRowTable
                isNeedShowHeader={true}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClinicalUpNextTable;
