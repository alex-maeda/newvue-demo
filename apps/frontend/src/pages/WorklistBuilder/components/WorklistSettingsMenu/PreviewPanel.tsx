import { FC, useState, useEffect, useMemo } from 'react';
import { Space } from 'antd';
import { SortingState } from '@tanstack/react-table';
// COMPONENTS
import TableComponent from '../../../../components/Table';
import Loader from '../../../../components/Loader';
// REDUX
import { IFiltersConfig } from '../../../../redux/types/adminSettingsTypes';
import { preparePatientData } from '../../../../redux/reducers/patientReducer';
// MODELS
import { IPatient } from '../../../../models/Patient';
import { ColorEnum } from '../../../../models/enums';

import { useAppSelector } from '../../../../hooks/hooks';
import { getColumns } from './utils';
import { titleForStatus } from '../../../Worklist/utils';
import {
  filteredAllPatients,
  filteredAnyPatients,
} from '../FiltersContent/utils';
import { defaultPriorities } from '../../../../utils/GeneralUtil';
import { getNameByAccessor } from '../../../../utils/TableUtil';

const PreviewPanel: FC<{
  className?: string;
}> = ({ className = '' }) => {
  const {
    getPatients: { isFetching, patients },
  } = useAppSelector(({ patients }) => patients);
  const {
    getWorklists: { currentWorklist },
    settingsFilters: { filtersSettings },
  } = useAppSelector(({ adminSettings }) => adminSettings);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'timer', desc: false },
  ]);
  const [data, setData] = useState<{
    patients: IPatient[];
    count: number;
    priorities: Record<ColorEnum, number>;
  }>({
    count: -1,
    patients: [],
    priorities: defaultPriorities,
  });
  const { filtersAll = {}, filtersAny = [] } =
    filtersSettings?.[currentWorklist.id] ??
    ({} as {
      filtersAll: IFiltersConfig;
      filtersAny: IFiltersConfig[];
    });

  const columnSettingsMemo = useMemo(
    () => currentWorklist.settings?.columnSettings || [],
    [currentWorklist],
  );

  const generatedColumns = useMemo(() => {
    return (currentWorklist.settings?.columnSettings || []).map((item) => ({
      header: getNameByAccessor(item.accessor),
      id: item.accessor,
      accessorKey: item.accessor,
      enableSorting: false,
      enableColumnFilter: false,
      enablePinning: true,
      minSize: 50,
      size: 150,
      maxSize: 200,
      enableResizing: false,
      meta: {
        order: item.order,
        disableTooltip: false,
      },
    }));
  }, [currentWorklist.settings?.columnSettings]);

  const columnMemoForTable = useMemo(() => {
    return [...getColumns, ...generatedColumns];
  }, [getColumns, generatedColumns]);

  const dataMemo = useMemo(() => {
    if (!Object.values(filtersAll).length && !filtersAny.length) {
      return patients;
    }
    return filteredAllPatients(patients, filtersAll).filter((patient) => {
      if (filtersAny.length) {
        return filteredAnyPatients(patient, filtersAny);
      }
      return true;
    });
  }, [patients, filtersAll, filtersAny]);

  useEffect(() => {
    if (dataMemo.length) {
      const { patients: newPatients, priorities } = preparePatientData(
        dataMemo.slice(0, 3),
        false,
      );
      newPatients.sort((a, b) => a.timer - b.timer);

      setData({
        patients: newPatients,
        priorities,
        count: dataMemo.length,
      });
    } else {
      setData({
        count: -1,
        patients: [],
        priorities: defaultPriorities,
      });
    }
  }, [dataMemo]);

  return (
    <div
      className={`table-panel expanded preview-table ${
        isFetching ? 'loading' : ''
      } ${className}`}
    >
      <div className="panel-header">
        {isFetching ? (
          <></>
        ) : (
          <div className="panel-title wide-center stack">
            <div className="stack-item">
              <h1>Worklist Preview</h1>
            </div>
            <Space className="stack-item" size={10}>
              {data.priorities &&
                Object.entries(data.priorities).map(([color, count]) => (
                  <div className={`span-status ${color}`} key={color}>
                    <strong>{count}</strong>
                    <span>{titleForStatus[color]}</span>
                  </div>
                ))}
            </Space>
          </div>
        )}
      </div>
      <div className="panel-body">
        {isFetching ? (
          <Loader />
        ) : (
          <div className="table-wrap double-table">
            <TableComponent<IPatient>
              // className={filterId === 0 ? 'search-result-table' : ''}
              columns={columnMemoForTable}
              data={data.patients || []}
              total={data.count}
              sorting={sorting}
              isDoubleRowTable={columnSettingsMemo.length > 0}
              onSortingChange={setSorting}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PreviewPanel;
