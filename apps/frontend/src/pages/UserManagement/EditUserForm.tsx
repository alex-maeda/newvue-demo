import { FC, useEffect, useMemo } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { Col, DatePicker, Form, Input, Row, Select, SelectProps } from 'antd';
import { FormInstance } from 'antd/lib/form';

import {
  IContactUserInfo,
  IPersonalUserInfo,
  IUser,
  IUserOtherInfo,
} from '../../models/User';
import { EEditUserItemsForm } from '../../components/AdminSettings/types';

import { useAppSelector } from '../../hooks/hooks';

const EditUserForm: FC<{ form: FormInstance }> = ({ form }) => {
  const {
    selectedUser,
    settingsFilters: {
      availableFiltersData: { filters },
    },
  } = useAppSelector(({ adminSettings }) => adminSettings);

  const {
    firstName = '',
    lastName = '',
    personalInfo: {
      title = '',
      DOB = '',
      gender = '',
      contactInfo: {
        address = '',
        phoneNumber = '',
        workEmail = '',
        homeEmail = '',
      } = {} as IContactUserInfo,
      otherInfo: {
        specialty = [''],
        insuranceCoverage = [''],
        credentialing = '',
        facilities = [''],
      } = {} as IUserOtherInfo,
    } = {} as IPersonalUserInfo,
  } = useMemo(() => selectedUser as IUser, [selectedUser]);

  const phoneNumberArray = (phoneNumber ?? '')?.split(' ');
  const phoneCountryCode = phoneNumberArray[0];
  const preparePhoneNumber = phoneNumberArray[1]?.replace(/\D/g, '');

  const prepareDataForMultiselect = (data: string[]) => {
    return data.map((item) => {
      return {
        label: item,
        value: item,
      };
    });
  };

  // -------------
  const handleChangeSpecialty = (value: string[]) => {
    console.log(`selected ${value}`);
  };

  const optionsSpecialty: SelectProps['options'] = prepareDataForMultiselect(
    filters['specialty'] as string[],
  );

  // -------------
  const handleChangeInsurance = (value: string[]) => {
    console.log(`selected ${value}`);
  };

  const optionsInsurance: SelectProps['options'] = prepareDataForMultiselect(
    filters['insurancePlan'] as string[],
  );

  // -------------
  const handleChangeFacilities = (value: string[]) => {
    console.log(`selected ${value}`);
  };

  const optionsFacilities: SelectProps['options'] = prepareDataForMultiselect(
    filters['facilityName'] as string[],
  );

  // -------------

  const disabledDate = (current: Dayjs) => {
    const today = dayjs();
    return current && current.isAfter(today);
  };

  useEffect(() => {
    form.setFieldsValue({
      [EEditUserItemsForm.FIRST_NAME]: firstName,
      [EEditUserItemsForm.LAST_NAME]: lastName,
      [EEditUserItemsForm.TITLE]: title,
      [EEditUserItemsForm.DOB]: dayjs(DOB, 'YYYY-MM-DD'),
      [EEditUserItemsForm.GENDER]: gender,
      [EEditUserItemsForm.ADDRESS]: address,
      [EEditUserItemsForm.PHONE_NUMBER]: preparePhoneNumber,
      [EEditUserItemsForm.PHONE_CODE_COUNTRY]: phoneCountryCode,
      [EEditUserItemsForm.WORK_EMAIL]: workEmail,
      [EEditUserItemsForm.HOME_EMAIL]: homeEmail,
      [EEditUserItemsForm.SPECIALTY]: specialty,
      [EEditUserItemsForm.INSURANCE]: insuranceCoverage,
      [EEditUserItemsForm.CREDENTIALING]: credentialing,
      [EEditUserItemsForm.FACILITIES]: facilities,
    });
  }, [selectedUser]);

  const prefixSelector = (
    <Form.Item name={EEditUserItemsForm.PHONE_CODE_COUNTRY} noStyle>
      <Select style={{ width: 70 }}>
        <Select.Option value="+1">+1</Select.Option>
      </Select>
    </Form.Item>
  );

  return (
    <Form layout="vertical" form={form} requiredMark={false}>
      <div className="personal-info">
        <strong>Personal info:</strong>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.FIRST_NAME}
              label="First name"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Input placeholder="Please enter first name" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.LAST_NAME}
              label="Last name"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Input placeholder="Please enter last name" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.TITLE}
              label="Title"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Input placeholder="Please enter user Title" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.DOB}
              label="Date of birth"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <DatePicker
                format={'DD/MM/YYYY'}
                disabledDate={disabledDate}
                showToday={false}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.GENDER}
              label="Gender"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Select placeholder="Please select user Gender">
                <Select.Option value="M">Male</Select.Option>
                <Select.Option value="F">Female</Select.Option>
                <Select.Option value="other">Other</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>
      </div>
      <div className="contact-info">
        <strong>Contact info:</strong>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.ADDRESS}
              label="Address"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Input placeholder="Please enter Address" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.PHONE_NUMBER}
              label="Phone number"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Input
                placeholder="Please enter Phone number"
                addonBefore={prefixSelector}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.WORK_EMAIL}
              label="Work email"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Input placeholder="Please enter Work email" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.HOME_EMAIL}
              label="Home email"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Input placeholder="Please enter Home email" />
            </Form.Item>
          </Col>
        </Row>
      </div>
      <div className="other-info">
        <strong>Other info:</strong>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.SPECIALTY}
              label="Specialty"
              rules={[
                {
                  required: true,
                  message: 'This select is required',
                },
              ]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Please choose Specialty"
                onChange={handleChangeSpecialty}
                options={optionsSpecialty}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.INSURANCE}
              label="Insurance Coverage"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Please choose Insurance Coverage"
                onChange={handleChangeInsurance}
                options={optionsInsurance}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.CREDENTIALING}
              label="Credentialing"
              rules={[
                {
                  required: true,
                  message: 'This select is required',
                },
              ]}
            >
              <Input placeholder="Please enter Credentialing" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name={EEditUserItemsForm.FACILITIES}
              label="Facilities"
              rules={[
                {
                  required: true,
                  message: 'This field is required',
                },
              ]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Please choose Facilities"
                onChange={handleChangeFacilities}
                options={optionsFacilities}
              />
            </Form.Item>
          </Col>
        </Row>
      </div>
    </Form>
  );
};

export default EditUserForm;
