import { FC, SyntheticEvent, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Form, InputNumber, Slider, Space } from 'antd';
import { IoIosAdd, IoIosClose } from 'react-icons/io';
import { CheckboxValueType } from 'antd/es/checkbox/Group';

import Panel from '../../../components/Panel';
import Loader from '../../../components/Loader';
import RecievesTable from './RecievesTable';

import { updateCurrentJob } from '../../../redux/reducers/adminSettingsReducer';
import { addNotificationAlert } from '../../../redux/reducers/chatReducer';

import { ENotificationsType } from '../../../models/enums';
import { IJob } from '../../../models/Job';

import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';
import { checkboxConfig, days, stydiesCheckboxConfig } from './utils';

import './style.scss';

const CheckboxGroup = Checkbox.Group;

const JobContent: FC = () => {
  const dispatch = useAppDispatch();
  const {
    getJobs: { currentJob },
    isTableFetching,
  } = useAppSelector(({ adminSettings }) => adminSettings);
  const [isChanged, setIsChanged] = useState(false);
  const [checkboxValues, setCheckboxValues] = useState<CheckboxValueType[]>([]);
  const [activeWeekButtons, setActiveWeekButtons] = useState<string[]>([
    'weekday',
  ]);
  const [activeDayButtons, setActiveDayButtons] = useState<string[]>([
    'Mon',
    'Tue',
  ]);
  const [timeStart, setTimeStart] = useState(9);
  const [timeEnd, setTimeEnd] = useState(17);
  const [intervals, setIntervals] = useState<string[]>([]);
  const [form1] = Form.useForm();
  const [form2] = Form.useForm();

  useEffect(() => {
    const { settings } = currentJob;
    if (
      !settings ||
      !settings.usersReceives.length ||
      !settings.userGroupsReceives.length
    ) {
      return;
    }

    setCheckboxValues(settings.studies);
    setIntervals(settings.intervals);
    handleReset();
  }, [currentJob]);

  const userGroupsReceives = useMemo(
    () => currentJob.settings?.userGroupsReceives || [],
    [currentJob],
  );

  const usersReceives = useMemo(
    () => currentJob.settings?.usersReceives || [],
    [currentJob],
  );

  const handleReset = () => {
    const filelds1: Record<string, boolean> = {};
    const filelds2: Record<string, boolean> = {};

    usersReceives.forEach((item) => {
      const { name, isChecked } = item;

      filelds1[`${name}_check`] = isChecked;
    });

    userGroupsReceives.forEach((item) => {
      const { name, isChecked } = item;

      filelds2[`${name}_check`] = isChecked;
    });

    form2.setFieldsValue(filelds2);
    form1.setFieldsValue(filelds1);

    setIsChanged(false);
  };

  const handleActiveWeekButtons = (button: string) => {
    const arr = [...activeWeekButtons];
    const index = arr.indexOf(button);
    if (index === -1) {
      arr.push(button);
    } else {
      arr.splice(index, 1);
    }
    setActiveWeekButtons(arr);
  };

  const handleActiveDayButtons = (button: string) => {
    const arr = [...activeDayButtons];
    const index = arr.indexOf(button);
    if (index === -1) {
      arr.push(button);
    } else {
      arr.splice(index, 1);
    }
    setActiveDayButtons(arr);
  };

  const handleTimeChange = (val: number[]) => {
    if (val && val.length === 2) {
      setTimeStart(val[0]);
      setTimeEnd(val[1]);
    }
  };

  const handleAddInterval = () => {
    if (timeStart && timeEnd) {
      setIntervals((prev) => [...prev, `${timeStart}:00 - ${timeEnd}:00`]);
    }
  };

  const handleRemoveInterval = (index: number) => {
    const newIntervals = [...intervals];
    newIntervals.splice(index, 1);
    setIntervals(newIntervals);
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

    const updatedData1 = usersReceives.map((item) => {
      const { name } = item;

      return {
        name,
        isChecked: form1.getFieldValue(`${name}_check`),
      };
    });

    const updatedData2 = userGroupsReceives.map((item) => {
      const { name } = item;

      return {
        name,
        isChecked: form2.getFieldValue(`${name}_check`),
      };
    });

    console.log(updatedData1, updatedData2);

    const updatedJob: IJob = {
      ...currentJob,
      settings: {
        studies: checkboxValues as string[],
        usersReceives: updatedData1,
        userGroupsReceives: updatedData2,
        intervals,
      },
    };

    dispatch(updateCurrentJob(updatedJob));

    setIsChanged(false);

    dispatch(
      addNotificationAlert({
        title: 'Changes saved',
        description: `All data for ${
          currentJob?.label ?? ''
        } job has been saved successfully`,
        type: ENotificationsType.SUCCESS,
      }),
    );
  };

  return (
    <Panel
      className="job-content-wrapper"
      header={
        <div>
          <h3>Setup “{currentJob?.label ?? ''}”</h3>
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
        <div className="areas-wrapper">
          <div>
            <div className="studies-list">
              <h2>What set of mapped criteria would you like to use?</h2>
              <CheckboxGroup
                value={checkboxValues}
                onChange={(val: CheckboxValueType[]) => {
                  setIsChanged(true);
                  setCheckboxValues(val);
                }}
                className="checkboxes"
                options={stydiesCheckboxConfig}
              />
            </div>
            <div className="checkboxes">
              <h2>Additional Options:</h2>
              <CheckboxGroup className="checkboxes" options={checkboxConfig} />
            </div>
          </div>
          <div>
            <Form
              form={form1}
              component={false}
              onFieldsChange={() => setIsChanged(true)}
            >
              <div className="receive-table-wrap">
                <h2>What users should receive studies?</h2>
                <RecievesTable title="User" data={usersReceives} />
              </div>
            </Form>
            <Form
              form={form2}
              component={false}
              onFieldsChange={() => setIsChanged(true)}
            >
              <div className="receive-table-wrap">
                <h2>What user groups should receive studies?</h2>
                <RecievesTable title="User group" data={userGroupsReceives} />
              </div>
            </Form>
          </div>
          <div>
            <h2>When should this job run?</h2>
            <Space size={4}>
              <Button
                className={
                  activeWeekButtons.includes('weekday') ? 'active' : ''
                }
                onClick={() => handleActiveWeekButtons('weekday')}
              >
                Weekday
              </Button>
              <Button
                className={
                  activeWeekButtons.includes('weekend') ? 'active' : ''
                }
                onClick={() => handleActiveWeekButtons('weekend')}
              >
                Weekend
              </Button>
            </Space>
            <Space size={4} wrap>
              {days.map((day, index) => (
                <Button
                  key={index}
                  className={activeDayButtons.includes(day) ? 'active' : ''}
                  onClick={() => handleActiveDayButtons(day)}
                >
                  {day}
                </Button>
              ))}
            </Space>
            <Space size={16} className="time-form">
              <label>Time of Day</label>
              <InputNumber
                min={1}
                max={timeEnd || 24}
                value={timeStart}
                formatter={(value) => `${value}:00`}
                parser={(value) => +value!.split(':')[0]}
                onChange={(val) => setTimeStart(val || 1)}
              />
              <InputNumber
                min={timeStart || 1}
                max={24}
                value={timeEnd}
                formatter={(value) => `${value}:00`}
                parser={(value) => +value!.split(':')[0]}
                onChange={(val) => setTimeEnd(val || 24)}
              />
              <Button
                icon={<IoIosAdd size={26} color="#8A85FF" />}
                onClick={() => handleAddInterval()}
              />
            </Space>
            <Slider
              min={1}
              max={24}
              range
              value={[timeStart, timeEnd]}
              onChange={handleTimeChange}
            />
            <div className="intervals-wrapper">
              {intervals.map((i, index) => (
                <div key={index}>
                  <span>{i}</span>
                  <Button
                    onClick={() => handleRemoveInterval(index)}
                    ghost
                    icon={<IoIosClose size={28} color="#999999" />}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default JobContent;
