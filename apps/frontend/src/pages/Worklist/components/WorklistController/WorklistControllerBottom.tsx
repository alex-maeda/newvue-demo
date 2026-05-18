import { FC } from 'react';
import { Button, Dropdown, Radio, RadioChangeEvent, Space, Switch } from 'antd';
import { IoChevronDown } from 'react-icons/io5';
import { IoMdClose } from 'react-icons/io';

import Panel from '../../../../components/Panel';

import { EPositionWorkListController } from '../../../../models/enums';

import {
  setIsShowWorklistControllerBlock,
  setWorklistControllerPosition,
  setWorklistDisplayMode,
  setWorklistSpecificList,
  toggleWorklistControllerPin,
} from '../../../../redux/reducers/toolbarSettingsReducer';

import { ReactComponent as Dots } from '../../../../assets/img/verticalDots.svg';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';

import {
  displayModeList,
  keyByPosition,
  menuItems,
  switcherList,
} from '../../utils';

const WorkListControllerBottom: FC = () => {
  const dispatch = useAppDispatch();
  const {
    worklistController: { expanded, specificList, displayMode, position },
  } = useAppSelector(({ toolbarSettings }) => toolbarSettings);

  const handleExpandChange = () => {
    dispatch(toggleWorklistControllerPin());
  };

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
    <Panel
      className={`${expanded ? 'expanded' : ''} worklist-controller bottom`}
    >
      <div className="controllers">
        <div className="display-mode">
          <p>Display mode:</p>
          <Radio.Group
            className="radio-group-wrapper-mode"
            onChange={handleChangeDisplayMode}
            value={displayMode}
          >
            <Space direction="vertical">
              {displayModeList.map((item, index) => (
                <div
                  key={index}
                  className={`radio-wrapper ${
                    displayMode === item.value ? 'active' : ''
                  }`}
                >
                  <Radio value={item.value}>
                    <span>{item.label}</span>
                  </Radio>
                </div>
              ))}
            </Space>
          </Radio.Group>
        </div>
        <div className="specific-list">
          <p>Specific list filters:</p>
          <div>
            {switcherList.map((i, index) => (
              <div key={index}>
                <label>
                  <Switch
                    defaultChecked={specificList.includes(i.value)}
                    onChange={() => handleChangeSpecificFilters(i.value)}
                    size="small"
                  />
                  {i.label}
                </label>
              </div>
            ))}
          </div>
        </div>
        <div className={`${expanded ? 'expanded' : ''} controller-action`}>
          <Button
            shape="circle"
            className={`header-icon ${
              !expanded ? 'expand-icon' : 'collapse-icon'
            } `}
            icon={<IoChevronDown size={24} color="#282C34" />}
            onClick={handleExpandChange}
          />
          <div>
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
      </div>
    </Panel>
  );
};

export default WorkListControllerBottom;
