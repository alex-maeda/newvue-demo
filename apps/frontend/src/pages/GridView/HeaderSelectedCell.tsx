import { FC } from 'react';

import { HeaderCellProps } from '../../components/AdminSettings/types';

const HeaderSelectedCell: FC<HeaderCellProps> = ({
  isSelected,
  children,
  ...restProps
}) => {
  return (
    <td {...restProps} className={isSelected ? 'selected' : ''}>
      {children}
    </td>
  );
};

export default HeaderSelectedCell;
