import { FC } from 'react';
import { Form, Switch } from 'antd';
import { AiOutlineCheck, AiOutlineClose } from 'react-icons/ai';

import { EditableCellProps } from '../AdminSettings/types';

const EditableCell: FC<EditableCellProps> = ({
  editing,
  dataIndex,
  isSelected,
  // title,
  // record,
  // index,
  children,
  ...restProps
}) => {
  return (
    <td {...restProps} className={isSelected ? 'selected' : ''}>
      {editing ? (
        <Form.Item valuePropName="checked" name={dataIndex}>
          <Switch
            checkedChildren={<AiOutlineCheck />}
            unCheckedChildren={<AiOutlineClose />}
          />
        </Form.Item>
      ) : (
        children
      )}
    </td>
  );
};

export default EditableCell;
