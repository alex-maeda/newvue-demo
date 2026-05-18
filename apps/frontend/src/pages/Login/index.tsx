import { FC, useEffect, useState } from 'react';
import { Form, Input, Button, Alert, Space } from 'antd';

import { ELoginFieldsName } from '../../models/enums';

import { useAppDispatch, useAppSelector } from '../../hooks/hooks';
import { ILoginRequestData } from '../../redux/types/authTypes';
import { signInThunk } from '../../redux/thunks/authThunk';

import './style.scss';

const LoginPage: FC = () => {
  const dispatch = useAppDispatch();
  const { error, isPending } = useAppSelector((state) => state.auth);
  const [submittable, setSubmittable] = useState<boolean>(false);

  const [form] = Form.useForm<ILoginRequestData>();
  const values = Form.useWatch([], form);

  const handleSubmit = () => {
    dispatch(signInThunk(form.getFieldsValue()));
  };

  useEffect(() => {
    form.validateFields({ validateOnly: true }).then(
      () => {
        setSubmittable(true);
      },
      () => {
        setSubmittable(false);
      },
    );
  }, [values]);

  return (
    <div className="login-page">
      <div className="brand">
        <span />
      </div>
      <div className="content">
        <div>
          {error?.message && (
            <div className="error-auth">
              <Alert message={error.message} type="error" />
            </div>
          )}
          <Form
            form={form}
            name="validateOnly"
            layout="vertical"
            autoComplete="off"
          >
            <Form.Item
              name={ELoginFieldsName.NAME}
              label="Username or email address"
              rules={[
                {
                  required: true,
                  message: 'Please enter your username or email address',
                },
              ]}
            >
              <Input id="name" />
            </Form.Item>
            <Form.Item
              name={ELoginFieldsName.PASSWORD}
              label="Password"
              rules={[
                {
                  required: true,
                  message: 'Please enter your password',
                },
              ]}
            >
              <Input.Password id="password" />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  disabled={!submittable}
                  onClick={handleSubmit}
                  loading={isPending}
                >
                  Sign in
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
