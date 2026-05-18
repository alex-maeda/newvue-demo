import { FC } from 'react';
import { Button, Checkbox, Dropdown, Radio, RadioChangeEvent } from 'antd';
import { IoMdClose } from 'react-icons/io';
import { useDrag } from 'react-dnd';

import Panel from '../../../../components/Panel';

import { EPositionWorkListController } from '../../../../models/enums';

import {
  setIsShowWorklistControllerBlock,
  setWorklistControllerPosition,
  setWorklistDisplayMode,
  setWorklistSpecificList,
} from '../../../../redux/reducers/toolbarSettingsReducer';

import { ReactComponent as Gear } from '../../../../assets/img/gear.svg';
import { ReactComponent as Dots } from '../../../../assets/img/verticalDots.svg';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';

import {
  CONTROLLER,
  displayModeList,
  keyByPosition,
  menuItems,
  switcherList,
} from '../../utils';

const WorkListControllerRight: FC = () => {
  const dispatch = useAppDispatch();
  const {
    worklistController: { specificList, displayMode, position },
    controllerPosition: { top, left },
  } = useAppSelector(({ toolbarSettings }) => toolbarSettings);

  const isFreePosition = position === EPositionWorkListController.FREE;

  const [{ isDragging }, drag, preview] = useDrag(
    () => ({
      type: CONTROLLER,
      item: { left, top },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [left, top],
  );

  if (isDragging) {
    return <div ref={drag} />;
  }

  const handleChangeDisplayMode = ({ target: { value } }: RadioChangeEvent) => {
    dispatch(setWorklistDisplayMode(value));
  };

  const handleChangeSpecificFilters = (value: string) => {
    dispatch(setWorklistSpecificList(value));
  };

  const handleMenuClick = (e: { key: string }) => {
    const key = e.key;

    switch (key) {
      case '1':
        dispatch(
          setWorklistControllerPosition(EPositionWorkListController.RIGHT),
        );
        break;
      case '2':
        dispatch(
          setWorklistControllerPosition(EPositionWorkListController.BOTTOM),
        );
        break;
      case '3':
        dispatch(
          setWorklistControllerPosition(EPositionWorkListController.FREE),
        );
        break;
    }
  };

  const handleCloseControllerBlock = () => {
    dispatch(setIsShowWorklistControllerBlock(false));
  };

  return (
    <div ref={isFreePosition ? preview : null}>
      <Panel
        style={{ left, top }}
        className={`worklist-controller ${position}`}
        header={
          <>
            <div ref={isFreePosition ? drag : null}>
              <Gear />
              <h1>Worklists Settings</h1>
            </div>
            <div className="controller-action">
              <div className="dropdown">
                <Dropdown
                  menu={{
                    items: menuItems,
                    onClick: (e) => handleMenuClick(e),
                    selectable: true,
                    defaultSelectedKeys: [keyByPosition[position]],
                  }}
                  trigger={['click']}
                  destroyPopupOnHide
                  overlayStyle={{
                    border: '1px solid #383E48',
                    boxShadow: '0px 10px 50px 0px #00000080',
                  }}
                >
                  <Dots />
                </Dropdown>
              </div>
              <Button
                type="text"
                shape="circle"
                className="header-icon"
                icon={<IoMdClose size={30} color="#999999" />}
                onClick={handleCloseControllerBlock}
              />
            </div>
          </>
        }
      >
        <div className="controllers">
          <div className="display-mode">
            <p>Display mode:</p>
            <Radio.Group
              className="radio-group-wrapper-mode"
              onChange={handleChangeDisplayMode}
              value={displayMode}
            >
              {displayModeList.map((item, index) => (
                <div key={index}>
                  <Radio.Button value={item.value}>{item.label}</Radio.Button>
                </div>
              ))}
            </Radio.Group>
          </div>
          <div className="specific-list">
            <p>Specific list filters:</p>
            <div>
              {switcherList.map((i, index) => (
                <Checkbox
                  key={index}
                  defaultChecked={specificList.includes(i.value)}
                  onChange={() => handleChangeSpecificFilters(i.value)}
                >
                  <span>{i.label}</span>
                </Checkbox>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
};

export default WorkListControllerRight;
