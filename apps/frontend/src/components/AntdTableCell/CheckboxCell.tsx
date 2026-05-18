import { FC } from 'react';
import { Form, Checkbox } from 'antd';

import { EditableCellProps } from '../AdminSettings/types';

const CheckboxCell: FC<EditableCellProps> = ({
  editing,
  dataIndex,
  // title,
  // record,
  // index,
  children,
  ...restProps
}) => {
  return (
    <td {...restProps}>
      {editing ? (
        <Form.Item valuePropName="checked" name={dataIndex}>
          <Checkbox />
        </Form.Item>
      ) : (
        children
      )}
    </td>
  );
};

export default CheckboxCell;
