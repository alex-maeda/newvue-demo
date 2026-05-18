import React, { useState, useEffect, useCallback } from 'react';
import { Button, Space } from 'antd';

import Panel from '../../../../components/Panel';
import ListContainer from './ListContainer';

import { updateCurrentWorklistColumnsSettings } from '../../../../redux/reducers/adminSettingsReducer';
import { addNotificationAlert } from '../../../../redux/reducers/chatReducer';

import { TColumnSetting } from '../../../../models/Filter';
import { ENotificationsType } from '../../../../models/enums';
import { DragItem } from './types';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import { allColumns, defaultTopColumn } from './utils';

import './style.scss';

const ColumnsContent: React.FC = () => {
  const dispatch = useAppDispatch();
  const [list1, setList1] = useState<TColumnSetting[]>([]);
  const [list2, setList2] = useState<TColumnSetting[]>([]);
  const [list3, setList3] = useState<TColumnSetting[]>([]);
  const [isChanged, setIsChanged] = useState(false);
  const {
    getWorklists: { currentWorklist },
  } = useAppSelector(({ adminSettings }) => adminSettings);

  const moveItem = useCallback(
    (
      source: DragItem,
      targetListIndex: number,
      targetIndex?: number, // This is the position where the item is dropped in the target list
    ) => {
      if (targetIndex && targetListIndex !== source.listIndex) {
        return;
      }

      const sourceList = [list1, list2, list3][source.listIndex];
      const targetList = [list1, list2, list3][targetListIndex];

      if (!sourceList[source.index]) {
        return;
      }

      const [movedItem] = sourceList.splice(source.index, 1);

      console.log('moveItem', source, targetListIndex, targetIndex);

      if (source.listIndex === targetListIndex) {
        // If it's the same list, insert at the target index
        targetList.splice(targetIndex!, 0, movedItem);
      } else {
        // If it's a different list, append to the end of the target list
        targetList.push(movedItem);
      }

      setList1([...list1]);
      setList2([...list2]);
      setList3([...list3]);
      setIsChanged(true);
    },
    [list1, list2, list3],
  );

  const handleReset = () => {
    console.log('reset');
    const initSettings = currentWorklist.settings?.columnSettings || [];
    if (initSettings.length) {
      const list1Data = [...allColumns];
      const list2Data: TColumnSetting[] = [defaultTopColumn];
      const list3Data: TColumnSetting[] = [];
      initSettings.forEach((setting) => {
        if (setting.accessor.includes('empty')) {
          return;
        }
        const index = list1Data.findIndex(
          (column) => column.accessor === setting.accessor,
        );
        if (index >= 0) {
          list1Data.splice(index, 1);
        }
        if (setting.order === 1) {
          list2Data.push(setting);
        }
        if (setting.order === 2) {
          list3Data.push(setting);
        }
      });
      setList1(list1Data);
      setList2(list2Data);
      setList3(list3Data);
    } else {
      setList1(allColumns);
      setList2([defaultTopColumn]);
      setList3([]);
    }

    setIsChanged(false);
  };

  const handlePreview = () => {
    if (!currentWorklist) {
      return;
    }

    const result: TColumnSetting[] = [];

    list2.forEach((item, index) => {
      if (item.accessor === 'actions') {
        if (list3[index]) {
          result.push({ ...list3[index], order: 2 });
        }
        return;
      }

      result.push({ ...item, order: 1 });

      result.push({
        accessor: list3[index]?.accessor || `empty${index}`,
        order: 2,
      });
    });

    if (list3.length > list2.length) {
      for (let i = list2.length; i < list3.length; i++) {
        result.push({ accessor: `empty${i}`, order: 1 });
        result.push({ ...list3[i], order: 2 });
      }
    }

    dispatch(updateCurrentWorklistColumnsSettings(result));
    setIsChanged(false);

    dispatch(
      addNotificationAlert({
        title: 'Changes saved',
        description: `Columns for ${
          currentWorklist?.label ?? ''
        } worklist has been saved successfully`,
        type: ENotificationsType.SUCCESS,
      }),
    );
  };

  useEffect(() => {
    handleReset();
  }, [currentWorklist]);

  // useEffect(() => {
  //   if (isChanged) {
  //     handlePreview();
  //   }
  // }, [list2, list3]);

  return (
    <Panel
      className="columns-content-wrapper"
      header={
        <div>
          <h3>Setup columns for “{currentWorklist.label}”</h3>
          <Space className="button-wrapper">
            <Button
              onClick={handlePreview}
              type="primary"
              disabled={!isChanged}
            >
              Save
            </Button>
            <Button
              onClick={handleReset}
              type="primary"
              ghost
              disabled={!isChanged}
            >
              Discard changes
            </Button>
          </Space>
        </div>
      }
      expanded
    >
      <div className="lists-wrapper">
        <div>
          <h2>Column</h2>
          <ListContainer items={list1} listIndex={0} onItemDrop={moveItem} />
        </div>
        <div>
          <h2>Top Column</h2>
          <ListContainer items={list2} listIndex={1} onItemDrop={moveItem} />
        </div>
        <div>
          <h2>Bottom Column</h2>
          <ListContainer items={list3} listIndex={2} onItemDrop={moveItem} />
        </div>
      </div>
    </Panel>
  );
};

export default ColumnsContent;
