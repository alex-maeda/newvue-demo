import { FC, useMemo } from 'react';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import CheckboxCell from '../../../../components/AntdTableCell/CheckboxCell';

import { TUserOrUserGroupRights } from '../../../../models/Filter';

import { defaultSortFn } from '../../../../utils/GeneralUtil';

import './style.scss';

const RightsTable: FC<{
  data: TUserOrUserGroupRights[];
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

  const columns: ColumnsType<TUserOrUserGroupRights> = useMemo(() => {
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
        title: 'View',
        dataIndex: 'view',
        onCell: (record: TUserOrUserGroupRights) => ({
          editing: true,
          dataIndex: `${record.name}_view`,
          title: 'view',
        }),
      },
      {
        title: 'Report',
        dataIndex: 'report',
        onCell: (record: TUserOrUserGroupRights) => ({
          editing: true,
          dataIndex: `${record.name}_report`,
          title: 'report',
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
      rowKey="name"
      dataSource={data}
      columns={columns}
      rowClassName="editable-row"
      pagination={false}
    />
  );
};

export default RightsTable;
