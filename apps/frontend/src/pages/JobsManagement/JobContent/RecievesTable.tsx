import { FC, useMemo } from 'react';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import CheckboxCell from '../../../components/AntdTableCell/CheckboxCell';

import { TUserOrUserGroupReceives } from '../../../models/Job';

import { defaultSortFn } from '../../../utils/GeneralUtil';

import './style.scss';

const RightsTable: FC<{
  data: TUserOrUserGroupReceives[];
  title: string;
}> = ({ data, title }) => {
  const preparedFilters = useMemo(() => {
    if (!data?.length) {
      return [];
    }

    return data.map((item) => ({
      text: item.name,
      value: item.name,
    }));
  }, [data]);

  const columns: ColumnsType<TUserOrUserGroupReceives> = useMemo(() => {
    return [
      {
        title: title,
        dataIndex: 'name',
        filters: preparedFilters,
        onFilter: (value, record) =>
          (record.name as string).indexOf(String(value)) === 0,
        sorter: (a, b) => defaultSortFn(a.name, b.name),
        showSorterTooltip: false,
      },
      {
        title: 'Receive',
        dataIndex: 'check',
        onCell: (record: TUserOrUserGroupReceives) => ({
          editing: true,
          dataIndex: `${record.name}_check`,
          title: 'check',
        }),
      },
    ];
  }, []);

  return (
    <Table
      components={{
        body: {
          cell: CheckboxCell,
        },
      }}
      dataSource={data}
      rowKey="name"
      columns={columns}
      rowClassName="editable-row"
      pagination={false}
    />
  );
};

export default RightsTable;
