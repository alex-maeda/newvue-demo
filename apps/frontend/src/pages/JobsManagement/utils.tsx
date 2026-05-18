import type { MenuProps } from 'antd';
import { FaCopy, FaPencil, FaTrashCan } from 'react-icons/fa6';

export const menuItems: MenuProps['items'] = [
  {
    label: 'Copy',
    key: '1',
    icon: <FaCopy size={16} color="#999999" />,
  },
  {
    label: 'Edit',
    key: '2',
    icon: <FaPencil size={16} color="#999999" />,
  },
  {
    label: 'Delete',
    key: '3',
    icon: <FaTrashCan size={16} />,
    danger: true,
  },
];
