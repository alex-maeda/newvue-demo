import { FC } from 'react';
import { RxLockClosed } from 'react-icons/rx';

const LockInfoIcon: FC<{ isLock: boolean | undefined }> = ({ isLock }) => {
  return (
    <span className="lock">
      {!!isLock ? <RxLockClosed size={16} /> : <></>}
    </span>
  );
};

export default LockInfoIcon;
