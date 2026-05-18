import {
  FC,
  useEffect,
  useState,
  useMemo,
  CSSProperties,
  memo,
  useCallback,
} from 'react';
import {
  Row as TRow,
  RowSelectionState,
  SortingState,
  ColumnFiltersState,
  CellContext,
  ColumnDef,
} from '@tanstack/react-table';
import { Button, Space, Switch } from 'antd';
import { IoChevronDown } from 'react-icons/io5';
import { IoMdClose } from 'react-icons/io';
import { useNavigate } from 'react-router-dom';
// COMPONENTS
import TableComponent from '../../../../components/Table';
import Loader from '../../../../components/Loader';
// REDUX
import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { preparePatientData } from '../../../../redux/reducers/patientReducer';
import { setHotKey } from '../../../../redux/reducers/utilsReducer';
import {
  resetSearchClinicalResult,
  setCurrentFilterId,
  storeFiltersSettings,
} from '../../../../redux/reducers/filterReducer';
// MODELS
import { IPatient } from '../../../../models/Patient';
import { IFilter } from '../../../../models/Filter';
import { ColorEnum } from '../../../../models/enums';

import { getColumns, titleForStatus } from '../../utils';
import { ClinicalInfoUrl } from '../../../../UrlsConfig';
import {
  defaultPriorities,
  defaultSortFn,
  getPatientLink,
} from '../../../../utils/GeneralUtil';
import { getCellValue, getNameByAccessor } from '../../../../utils/TableUtil';
//import { preliminaryState } from '../../../../redux/reducers/followUpReducer';
import { useWindowContext } from '../../../../contexts/WindowContext';

const PanelTable: FC<{
  filter: IFilter;
  searchParams: string | number | number[];
  isNeedCollapse?: boolean;
  dataArr: IPatient[];
  callback: (value: string) => void;
  className?: string;
  style?: CSSProperties;
}> = ({
  filter,
  dataArr,
  searchParams,
  isNeedCollapse = false,
  callback,
  className = '',
  style = {},
}) => {
  const {
    getPatients: { isFetching },
  } = useAppSelector(({ patients }) => patients);
  const {
    getColumnSetting: { columnSettings },
  } = useAppSelector(({ adminSettings }) => adminSettings);
  const { hotKey } = useAppSelector(({ utils }) => utils);
  const { lastCheckedFilterId } = useAppSelector(({ filter }) => filter);
  const dispatch = useAppDispatch();
  const [selectedItems, setSelectedItems] = useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [needToSave, setNeedToSave] = useState<boolean>(true);
  const [sorting, setSorting] = useState<SortingState>(
    filter.settings?.sorting || [{ id: 'timer', desc: false }],
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    filter.settings?.filters || [],
  );
  const [data, setData] = useState<{
    patients: IPatient[];
    count: number;
    priorities: Record<ColorEnum, number>;
  }>({
    count: -1,
    patients: [],
    priorities: defaultPriorities,
  });
  const { openWindow } = useWindowContext();
  const navigate = useNavigate();

  const generatedColumns = useMemo(() => {
    return (filter.settings?.columnSettings || columnSettings).map((item) => {
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
          getCellValue(
            ((info.getValue() as string) ?? '')?.toUpperCase(),
            searchParams,
          ),
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
  }, [columnSettings, filter.settings?.columnSettings]);

  const columnMemoForTable = useMemo(() => {
    return [...getColumns(searchParams), ...generatedColumns];
  }, [generatedColumns, searchParams]);

  useEffect(() => {
    if (filter.id === lastCheckedFilterId) {
      const element = document.getElementById(filter.id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    const { patients, priorities } = preparePatientData(dataArr, false);
    patients.sort((a, b) => a.timer - b.timer);

    setData({
      patients,
      priorities,
      count: patients.length,
    });

    setIsLoading(false);
  }, [dataArr]);

  useEffect(() => {
    if (data.patients.length) {
      if (filter.id === lastCheckedFilterId) {
        setSelectedItems({ 0: true });
      } else {
        setSelectedItems({});
      }
    }
  }, [lastCheckedFilterId, data]);

  useEffect(() => {
    const { settings } = filter;

    if (
      needToSave &&
      typeof searchParams === 'number' &&
      (settings?.filters !== columnFilters || settings?.sorting !== sorting)
    ) {
      dispatch(
        storeFiltersSettings({
          filterId: filter.id,
          sorting,
          filters: columnFilters,
        }),
      );
      return;
    }

    if (!needToSave) {
      dispatch(
        storeFiltersSettings({
          filterId: filter.id,
          sorting: [{ id: 'timer', desc: false }],
          filters: [],
        }),
      );
    }
  }, [needToSave, sorting, columnFilters]);

  useEffect(() => {
    if (!hotKey || !Object.keys(selectedItems).length) {
      return;
    }

    const keyIndex = hotKey.substring(2);
    if (keyIndex === 'O') {
      dispatch(setHotKey(''));
      const selectedIndex = +Object.keys(selectedItems)[0];
      navigateToClinicalInfo(data.patients[selectedIndex].id);
    }
  }, [hotKey]);

  const handleRowClick = useCallback(
    (rowData: TRow<IPatient>, isDoubleClick = true): void => {
      const { id, MRN, accession, patientLink } = rowData.original;
      setSelectedItems({});

      const CLINICAL_INFO_IDS = new Set([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 25, 41, 52, 100, 101,
      ]);
      if (isDoubleClick && CLINICAL_INFO_IDS.has(id)) {
        // For Alberto Seels (ID: 9), also open the external Mach7 viewer in popup
        if (id === 9) {
          const viewerUrl = getPatientLink(MRN, String(accession), patientLink);
          openWindow(viewerUrl);
        }
        navigateToClinicalInfo(id);
      } else if (isDoubleClick) {
        openWindow(getPatientLink(MRN, String(accession), patientLink));
      }
    },
    [selectedItems],
  );

  const navigateToClinicalInfo = (id: number) => {
    if (id !== 12) {
      if (typeof searchParams === 'number') {
        dispatch(setCurrentFilterId(searchParams));
      }
      dispatch(resetSearchClinicalResult());

      navigate(`${ClinicalInfoUrl}/${id}?viewOnly=true`);
    }
  };

  useEffect(() => {
    isNeedCollapse ? setExpanded(false) : setExpanded(true);
  }, [isNeedCollapse]);

  return (
    <div
      id={filter.id}
      className={`table-panel ${expanded ? 'expanded' : ''} ${
        (isFetching || isLoading) && expanded ? 'loading' : ''
      } ${className}`}
      style={style}
    >
      <div className="panel-header">
        {(isFetching || isLoading) && expanded ? (
          <></>
        ) : (
          <div className="panel-title wide-center stack">
            <div className="stack-item">
              <h1>{filter.label}</h1>
            </div>
            <Space className="stack-item" size={10}>
              <Space>
                <label>
                  <Switch
                    size="small"
                    checked={needToSave}
                    onChange={(checked) => setNeedToSave(checked)}
                  />
                  Autosave filters
                </label>
              </Space>
              {data.priorities &&
                Object.entries(data.priorities).map(([color, count]) => (
                  <div className={`span-status ${color}`} key={color}>
                    <strong>{count}</strong>
                    <span>{titleForStatus[color]}</span>
                  </div>
                ))}
            </Space>
            <Button
              shape="circle"
              className={`header-icon ${
                expanded ? 'expand-icon' : 'collapse-icon'
              } `}
              icon={<IoChevronDown size={24} color="#282C34" />}
              onClick={() => setExpanded((prev) => !prev)}
            />
            <Button
              type="text"
              shape="circle"
              className="header-icon"
              icon={<IoMdClose size={30} color="#999999" />}
              onClick={() => callback(filter.id)}
            />
          </div>
        )}
      </div>
      <div
        className="panel-body"
        // style={{
        //   maxHeight: `${patients[filterId]?.length > 5 ? '440px' : '100%'} `,
        //   // flexGrow: `${patients[filterId]?.length > 5 ? '1' : '0'} `,
        // }}
      >
        {(isFetching || isLoading) && expanded ? (
          <Loader />
        ) : (
          <div className="table-wrap double-table">
            <TableComponent<IPatient>
              // className={filterId === 0 ? 'search-result-table' : ''}
              columns={columnMemoForTable}
              data={data.patients}
              total={data.count}
              sorting={sorting}
              filters={columnFilters}
              isSelectable
              isDoubleRowTable
              rowSelection={selectedItems}
              handleRowClick={handleRowClick}
              onRowSelectionChange={setSelectedItems}
              onSortingChange={setSorting}
              onFilterChange={setColumnFilters}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const PanelTableMemo = memo(PanelTable, (prevProps, nextProps) => {
  return (
    prevProps.dataArr === nextProps.dataArr &&
    prevProps.filter === nextProps.filter &&
    prevProps.searchParams === nextProps.searchParams
  );
});

export default PanelTableMemo;
