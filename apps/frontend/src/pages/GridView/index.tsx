import { FC, useState, useEffect, useMemo, SyntheticEvent } from 'react';
import { Button, Form, Select, Space, Table } from 'antd';
import { AiOutlineCheck, AiOutlineClose } from 'react-icons/ai';
import type { ColumnType, ColumnsType, TableProps } from 'antd/es/table';
import { FilterValue } from 'antd/es/table/interface';

import EditableCell from '../../components/AntdTableCell/EditableCell';
import HeaderSelectedCell from './HeaderSelectedCell';
import Loader from '../../components/Loader';
import Panel from '../../components/Panel';

import {
  getInsurancePlansCorrespondThunk,
  getOrderingPhysicianCorrespondThunk,
  getSpecialtiesCorrespondThunk,
  getUsersListThunk,
  getWorklistCorrespondThunk,
  getWorklistThunk,
} from '../../redux/thunks/adminSettingsThunk';
import { TCorrespondData } from '../../redux/types/adminSettingsTypes';
import {
  saveInsurancePlansCorrespondData,
  saveOrderingPhysicianCorrespondData,
  saveSpecialtiesCorrespondData,
  saveWorklistCorrespondData,
} from '../../redux/reducers/adminSettingsReducer';
import { addNotificationAlert } from '../../redux/reducers/chatReducer';

import { ETableHeader } from '../../components/AdminSettings/types';
import { ENotificationsType } from '../../models/enums';

import { rowsOptions, titlesMap } from './utils';
import { useAppDispatch, useAppSelector } from '../../hooks/hooks';

import './style.scss';

const initEditCell = {
  row: '',
  column: '',
};

const CorrespondenceTable: FC = () => {
  const dispatch = useAppDispatch();
  const [rows, setRows] = useState<ETableHeader>();
  const [editCell, setEditCell] = useState<{ row: string; column: string }>(
    initEditCell,
  );
  const [data, setData] = useState<TCorrespondData[]>([]);
  const [filteredInfo, setFilteredInfo] = useState<
    Record<string, FilterValue | null>
  >({});
  const {
    usersList,
    worklistCorrespondData,
    insurancePlansCorrespondData,
    specialtiesCorrespondData,
    orderingPhysicianCorrespondData,
    isTableFetching,
  } = useAppSelector(({ adminSettings }) => adminSettings);
  const [form] = Form.useForm();

  useEffect(() => {
    dispatch(getUsersListThunk());
    dispatch(getWorklistThunk());
  }, []);

  useEffect(() => {
    if (rows === ETableHeader.INSURANCE) {
      dispatch(getInsurancePlansCorrespondThunk());
    }
    if (rows === ETableHeader.WORKLIST) {
      dispatch(getWorklistCorrespondThunk());
    }
    if (rows === ETableHeader.SPECIALTIES) {
      dispatch(getSpecialtiesCorrespondThunk());
    }
    if (rows === ETableHeader.PHYSICIAN) {
      dispatch(getOrderingPhysicianCorrespondThunk());
    }
  }, [rows]);

  useEffect(() => {
    if (
      rows === ETableHeader.INSURANCE &&
      insurancePlansCorrespondData.length
    ) {
      setData(insurancePlansCorrespondData);
    }
    if (rows === ETableHeader.WORKLIST && worklistCorrespondData.length) {
      setData(worklistCorrespondData);
    }
    if (rows === ETableHeader.SPECIALTIES && specialtiesCorrespondData.length) {
      setData(specialtiesCorrespondData);
    }
    if (
      rows === ETableHeader.PHYSICIAN &&
      orderingPhysicianCorrespondData.length
    ) {
      setData(orderingPhysicianCorrespondData);
    }
  }, [
    worklistCorrespondData,
    insurancePlansCorrespondData,
    specialtiesCorrespondData,
    orderingPhysicianCorrespondData,
  ]);

  const isEditing = (record: TCorrespondData, dataIndex: string) =>
    (!editCell.row && dataIndex === editCell.column) ||
    (record.key === editCell.row && !editCell.column) ||
    (record.key === editCell.row && dataIndex === editCell.column);

  const handleEditCell = ({
    row,
    column,
  }: {
    row?: string;
    column?: string;
  }) => {
    const filelds: Record<string, boolean> = {};
    data.forEach((item, index) => {
      Object.keys(item).forEach((key) => {
        const filter = filteredInfo.key?.[0];
        if (
          !filter ||
          (filter && item.key.toString().includes(filter as string))
        ) {
          if (
            (!row && key === column) ||
            (item.key === row && !column) ||
            (item.key === row && key === column)
          ) {
            const id = `${index}${key}`;
            filelds[id] = !!item[key];
          }
        }
      });
    });
    form.setFieldsValue(filelds);
    setEditCell({ row: row || '', column: column || '' });
  };

  const preparedFilters = useMemo(() => {
    if (!data?.length) {
      return [];
    }

    return data.map((item) => ({
      text: item.key,
      value: item.key,
    }));
  }, [data]);

  const columns: ColumnsType<TCorrespondData> = useMemo(() => {
    if (!rows || !usersList) {
      return [];
    }

    const initialColums: ColumnType<TCorrespondData> = {
      title: titlesMap[rows] || '',
      dataIndex: 'key',
      rowScope: 'row',
      filters: preparedFilters,
      onFilter: (value, record) =>
        (record.key as string).indexOf(String(value)) === 0,
      render: (text, record) => {
        return (
          <div onClick={() => handleEditCell({ row: record.key as string })}>
            {text}
          </div>
        );
      },
      onCell: (record: TCorrespondData) => ({
        editing: false,
        dataIndex: '',
        title: '',
        isSelected: editCell.row === record.key && !editCell.column,
      }),
    };

    const generatedColumns: ColumnsType<TCorrespondData> = usersList.map(
      ({ firstName, lastName }) => {
        const name = `${firstName} ${lastName}`;
        return {
          title: name,
          dataIndex: name,
          render: (text, record) => {
            return (
              <div
                onClick={() =>
                  handleEditCell({ row: record.key as string, column: name })
                }
              >
                {text ? <AiOutlineCheck /> : <AiOutlineClose />}
              </div>
            );
          },
          onCell: (record: TCorrespondData, index) => ({
            editing: isEditing(record, name),
            dataIndex: `${index}${name}`,
            title: name,
            isSelected: isEditing(record, name),
          }),
          onHeaderCell: () => ({
            isSelected: editCell.column === name && !editCell.row,
            onClick: () => handleEditCell({ column: name }),
          }),
        };
      },
    );

    return [initialColums, ...generatedColumns];
  }, [rows, usersList, editCell, preparedFilters, data]);

  const onChange: TableProps<TCorrespondData>['onChange'] = (_, filters) => {
    setFilteredInfo(filters);
  };

  const onValuesChange = (
    changedValues: Parameters<typeof Form>[0],
    allValues: Parameters<typeof Form>,
  ) => {
    const value = Object.values(changedValues)[0];
    const filelds: Record<string, boolean> = {};
    Object.keys(allValues).forEach((key) => {
      filelds[key] = value;
    });
    form.setFieldsValue(filelds);
  };

  const handleSave = (e: SyntheticEvent) => {
    if (!Object.keys(form.getFieldsValue()).length) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const updatedData = [...data];

    Object.entries(form.getFieldsValue()).forEach(([key, value]) => {
      const rowIndex: number = +key.slice(0, 1);
      const dataIndex = key.substring(1);
      if (updatedData[rowIndex]) {
        updatedData[rowIndex] = {
          ...updatedData[rowIndex],
          [dataIndex]: !!value,
        };
      }
    });

    if (rows === ETableHeader.INSURANCE) {
      dispatch(saveInsurancePlansCorrespondData(updatedData));
    }
    if (rows === ETableHeader.WORKLIST) {
      dispatch(saveWorklistCorrespondData(updatedData));
    }
    if (rows === ETableHeader.SPECIALTIES) {
      dispatch(saveSpecialtiesCorrespondData(updatedData));
    }
    if (rows === ETableHeader.PHYSICIAN) {
      dispatch(saveOrderingPhysicianCorrespondData(updatedData));
    }

    setEditCell(initEditCell);
    form.resetFields();

    dispatch(
      addNotificationAlert({
        title: 'Changes saved',
        description: `Grid for ${rows} worklist has been saved successfully`,
        type: ENotificationsType.SUCCESS,
      }),
    );
  };

  const isSubmitDisable = !editCell.row && !editCell.column;

  return (
    <Panel className="correspond-table">
      <Space className="select-wrapper">
        <Select
          className="select-item"
          placeholder="Select data type"
          style={{ width: 120 }}
          onChange={(value) => setRows(value)}
          options={rowsOptions}
        />
        <Button type="primary" disabled={isSubmitDisable} onClick={handleSave}>
          Submit
        </Button>
      </Space>
      {isTableFetching ? (
        <Loader />
      ) : !!data.length ? (
        <Form form={form} component={false} onValuesChange={onValuesChange}>
          <Table
            components={{
              header: {
                cell: HeaderSelectedCell,
              },
              body: {
                cell: EditableCell,
              },
            }}
            dataSource={data}
            columns={columns}
            rowClassName="editable-row"
            pagination={false}
            onChange={onChange}
          />
        </Form>
      ) : (
        <></>
      )}
    </Panel>
  );
};

export default CorrespondenceTable;
