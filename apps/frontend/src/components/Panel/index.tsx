import { FC, ReactNode } from 'react';
import './style.scss';

const Panel: FC<{
  expanded?: boolean;
  className?: string;
  style?: Record<string, string | number>;
  header?: ReactNode | string;
  children: JSX.Element | JSX.Element[];
}> = (props) => {
  const { className, header, children, style, expanded = false } = props;
  // const [isActive, setIsActive] = useState<boolean>(false);

  return (
    <div
      style={style}
      className={`panel ${expanded ? 'expanded' : ''} ${
        !!className ? className : ''
      }`}
    >
      <div>
        {header && <div className="panel-header">{header}</div>}
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
};

export default Panel;
