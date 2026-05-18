import { FC, useMemo, useState, useEffect } from 'react';
import {
  Row as TRow,
  SortingState,
  RowSelectionState,
} from '@tanstack/react-table';
import { Button, Drawer, Form, Space } from 'antd';

import Panel from '../../components/Panel';
import TableComponent from '../../components/Table';
import Loader from '../../components/Loader';
import EditUserForm from './EditUserForm';

import {
  getUserInfo,
  resetUserInfo,
} from '../../redux/reducers/adminSettingsReducer';
import {
  getAvailableFiltersData,
  getUsersListThunk,
} from '../../redux/thunks/adminSettingsThunk';

import { IUser } from '../../models/User';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { columns } from './utils';

import './style.scss';

const UserManagement: FC = () => {
  const { isFetching, usersList, selectedUser } = useAppSelector(
    ({ adminSettings }) => adminSettings,
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectedItems, setSelectedItems] = useState<RowSelectionState>({});
  const [open, setOpen] = useState<boolean>(false);
  const [form] = Form.useForm();

  const dispatch = useAppDispatch();

  const { firstName = '', lastName = '' } = selectedUser as IUser;

  const dataMemo = useMemo(() => usersList || [], [usersList]);
  const columnsMemo = useMemo(() => columns, []);

  const handleRowClick = (rowData: TRow<IUser>): void => {
    setSelectedItems({ [rowData.id]: true });
    dispatch(getUserInfo(rowData.original.id));
    setOpen(true);
  };

  const handleSubmit = () => {
    const isError = !!form.getFieldsError().filter((i) => !!i.errors.length)
      .length;

    if (!isError) {
      form.submit();
      const formValue = form.getFieldsValue();
      const modifyValue = {
        ...formValue,
        DOB: formValue.DOB.format('YYYY-MM-DD'),
      };
      console.log('modifyValue', modifyValue);
    }
  };

  const handleClose = () => {
    setOpen(false);
    dispatch(resetUserInfo());
    form.resetFields();
  };

  useEffect(() => {
    dispatch(getUsersListThunk());
    dispatch(getAvailableFiltersData());
    return () => {
      dispatch(resetUserInfo());
    };
  }, []);

  return (
    <Panel className="user-management">
      <div>
        {isFetching ? (
          <div className="loader-wrapper">
            <Loader />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <TableComponent<IUser>
                columns={columnsMemo}
                data={dataMemo}
                total={dataMemo.length}
                sorting={sorting}
                handleRowClick={handleRowClick}
                onSortingChange={setSorting}
                isSelectable
                rowSelection={selectedItems}
                // onRowSelectionChange={setSelectedItems}
              />
            </div>
            <Drawer
              className="sidebar-show-user-info"
              title={`Edit ${firstName} ${lastName}`}
              width={720}
              onClose={handleClose}
              open={open}
              destroyOnClose
              extra={
                <Space className="button-wrapper" wrap>
                  <Button onClick={handleClose} className="cancel">
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} className="submit">
                    Save
                  </Button>
                </Space>
              }
            >
              {Object.values(selectedUser).length ? (
                <EditUserForm form={form} />
              ) : (
                <></>
              )}
            </Drawer>
          </>
        )}
      </div>
    </Panel>
  );
};

export default UserManagement;
