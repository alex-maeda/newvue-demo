import { FC, useMemo } from 'react';
import { Button } from 'antd';
import { HiOutlineExternalLink } from 'react-icons/hi';

const LinkCell: FC<{
  linkUrl: string;
  idKey: number;
}> = (props) => {
  const { linkUrl, idKey } = props;

  const link = useMemo(() => `${linkUrl || ''}/${idKey}`, [idKey, linkUrl]);

  return (
    <Button
      className="custom-link-table"
      type="link"
      href={link}
      target="blank"
      icon={<HiOutlineExternalLink size={17} />}
    />
  );
};

export default LinkCell;
