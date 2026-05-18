import { FC, SyntheticEvent, useEffect, useMemo, useState } from 'react';
import { Button, Form, Space } from 'antd';

import Panel from '../../../../components/Panel';
import Loader from '../../../../components/Loader';
import RightsTable from './RightsTable';

import { saveRightsData } from '../../../../redux/reducers/adminSettingsReducer';
import { addNotificationAlert } from '../../../../redux/reducers/chatReducer';

import { ENotificationsType } from '../../../../models/enums';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';

import './style.scss';

const UsersContent: FC = () => {
  const dispatch = useAppDispatch();
  const {
    getWorklists: { currentWorklist },
    isTableFetching,
  } = useAppSelector(({ adminSettings }) => adminSettings);
  const [isChanged, setIsChanged] = useState(false);
  const [form1] = Form.useForm();
  const [form2] = Form.useForm();

  useEffect(() => {
    const { settings } = currentWorklist;
    if (
      !settings ||
      !settings.usersRights.length ||
      !settings.userGroupsRights.length
    ) {
      return;
    }

    handleReset();
  }, [currentWorklist]);

  const userGroupsRights = useMemo(
    () => currentWorklist.settings?.userGroupsRights || [],
    [currentWorklist],
  );

  const usersRights = useMemo(
    () => currentWorklist.settings?.usersRights || [],
    [currentWorklist],
  );

  const handleReset = () => {
    const filelds1: Record<string, boolean> = {};
    const filelds2: Record<string, boolean> = {};

    userGroupsRights.forEach((item) => {
      const { name, isView, isReport } = item;

      filelds1[`${name}_view`] = isView;
      filelds1[`${name}_report`] = isReport;
    });

    usersRights.forEach((item) => {
      const { name, isView, isReport } = item;

      filelds2[`${name}_view`] = isView;
      filelds2[`${name}_report`] = isReport;
    });

    form1.setFieldsValue(filelds1);
    form2.setFieldsValue(filelds2);

    setIsChanged(false);
  };

  const handleSave = (e: SyntheticEvent) => {
    if (
      !isChanged ||
      !Object.keys(form1.getFieldsValue()).length ||
      !Object.keys(form2.getFieldsValue()).length
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const updatedData1 = userGroupsRights.map((item) => {
      const { name } = item;

      return {
        name,
        isView: form1.getFieldValue(`${name}_view`),
        isReport: form1.getFieldValue(`${name}_report`),
      };
    });

    const updatedData2 = usersRights.map((item) => {
      const { name } = item;

      return {
        name,
        isView: form2.getFieldValue(`${name}_view`),
        isReport: form2.getFieldValue(`${name}_report`),
      };
    });

    dispatch(
      saveRightsData({
        userGroupsRights: updatedData1,
        usersRights: updatedData2,
      }),
    );

    setIsChanged(false);

    dispatch(
      addNotificationAlert({
        title: 'Changes saved',
        description: `Users for ${
          currentWorklist?.label ?? ''
        } worklist has been saved successfully`,
        type: ENotificationsType.SUCCESS,
      }),
    );
  };

  return (
    <Panel
      className="users-content-wrapper"
      header={
        <div>
          <h3>Setup users for “{currentWorklist?.label ?? ''}”</h3>
          <Space className="button-wrapper">
            <Button onClick={handleSave} type="primary" disabled={!isChanged}>
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
    >
      {isTableFetching ? (
        <Loader />
      ) : (
        <>
          <Form
            form={form1}
            component={false}
            onFieldsChange={() => setIsChanged(true)}
          >
            <RightsTable title="User group" data={userGroupsRights} />
          </Form>
          <Form
            form={form2}
            component={false}
            onFieldsChange={() => setIsChanged(true)}
          >
            <RightsTable title="User" data={usersRights} />
          </Form>
        </>
      )}
    </Panel>
  );
};

export default UsersContent;
