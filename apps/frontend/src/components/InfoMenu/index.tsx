import { FC, MouseEvent, TouchEvent } from 'react';
import { Tooltip } from 'antd';
import { IoClose } from 'react-icons/io5';
// MODELS
import { EWheelMenuItemName } from '../../models/enums';
// REDUX
import { useAppDispatch } from '../../hooks/hooks';
import { resetMenuProps } from '../../redux/reducers/menuReducer';
import {
  findingsDeliveryFeedbackState,
  preliminaryExamQualityFeedbackState,
} from '../../redux/reducers/followUpReducer';

import './styles.scss';

interface Icon {
  name: EWheelMenuItemName;
  icon: string;
}

const InfoMenu: FC<{ closeMenu(): void }> = ({ closeMenu }) => {
  const dispatch = useAppDispatch();

  const hideMenu = (e: MouseEvent) => {
    e.stopPropagation();

    closeMenu();
    dispatch(resetMenuProps());
  };

  const menuItemAction = (name: EWheelMenuItemName) => {
    switch (name) {
      case EWheelMenuItemName.FINDINGS_DELIVERY:
        dispatch(findingsDeliveryFeedbackState(true));
        break;
      case EWheelMenuItemName.PEER_LEARNING:
        console.log(EWheelMenuItemName.PEER_LEARNING);
        break;
      case EWheelMenuItemName.IMAGE_QA:
        dispatch(preliminaryExamQualityFeedbackState(true));
        break;
      default:
        break;
    }
  };

  const handleSelect = (
    e: MouseEvent | TouchEvent,
    name: EWheelMenuItemName,
  ) => {
    e.stopPropagation();
    menuItemAction(name);

    dispatch(resetMenuProps());
  };

  const icons: Icon[] = [
    { name: EWheelMenuItemName.PEER_LEARNING, icon: 'peerLearning' },
    { name: EWheelMenuItemName.IMAGE_QA, icon: 'imageQa' },
    { name: EWheelMenuItemName.FINDINGS_DELIVERY, icon: 'followUp' },
  ];

  return (
    <div className="menu-container" onMouseLeave={hideMenu}>
      <div className="menu">
        <span
          className="button close"
          data-icon="table-button-icon"
          onClick={hideMenu}
        >
          <IoClose size={20} />
        </span>

        {icons.map((item, index) => (
          <Tooltip
            key={index}
            placement="top"
            trigger="hover"
            title={<p>{item.name}</p>}
            destroyTooltipOnHide={true}
          >
            <span
              className={`button icon-${index + 1} ${item.icon}`}
              data-icon="table-button-icon"
              onClick={(e) => handleSelect(e, item.name)}
            ></span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

export default InfoMenu;
