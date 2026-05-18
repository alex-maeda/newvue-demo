import { FC, useEffect, useState } from 'react';
import { Button, Checkbox, Space } from 'antd';
import { IoIosAdd } from 'react-icons/io';
import { BiRightArrowAlt } from 'react-icons/bi';
import { MdClose } from 'react-icons/md';

import Panel from '../../../../components/Panel';

import { addNotificationAlert } from '../../../../redux/reducers/chatReducer';
import {
  setFiltersAll,
  setFiltersAny,
} from '../../../../redux/reducers/adminSettingsReducer';
import { IFiltersConfig } from '../../../../redux/types/adminSettingsTypes';

import {
  EConditionType,
  ENotificationsType,
  EOperators,
  ETableColumnAccessor,
} from '../../../../models/enums';

import { useAppDispatch, useAppSelector } from '../../../../hooks/hooks';
import {
  checkboxConfig,
  nameByColumn,
  operatorsByColumn,
  prepareAllFilterForSet,
  prepareAnyFilterForSet,
  prepareAllFilterForUi,
  symbolByOperator,
  prepareAnyFilterForUi,
} from './utils';
import { allColumns } from '../ColumnsContents/utils';
import { getNameByAccessor } from '../../../../utils/TableUtil';

import './style.scss';

const CheckboxGroup = Checkbox.Group;

const FiltersContent: FC = () => {
  const {
    getWorklists: { currentWorklist },
    settingsFilters: {
      availableFiltersData: { filters },
      filtersSettings,
    },
  } = useAppSelector(({ adminSettings }) => adminSettings);
  const [isChanged, setIsChanged] = useState<boolean>(false);
  const [activeColumn, setActiveColumn] = useState<
    ETableColumnAccessor | string
  >('');
  const [activeOperator, setActiveOperator] = useState<EOperators | string>('');
  const [activeValue, setActiveValue] = useState<
    Array<string | number | boolean | string[] | null>
  >([]);
  const [expression, setExpression] = useState<string[]>([]);
  const [allLine, setAllLine] = useState<string[]>([]);
  const [anyLine, setAnyLine] = useState<string[]>([]);
  const [error, setError] = useState<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dispatch = useAppDispatch();
  const { filtersAll, filtersAny } =
    filtersSettings?.[currentWorklist.id] ??
    ({} as {
      filtersAll: IFiltersConfig;
      filtersAny: IFiltersConfig[];
    });

  // const handleCheck = (e: CheckboxValueType) => {
  //   const value = e.target.value;
  //   setCheckboxValues((prev) => {
  //     if (prev.includes(value)) {
  //       return prev.filter((item) => item !== value);
  //     }
  //     return [...prev, value];
  //   });
  // };

  const stateReset = () => {
    setIsChanged(false);
    setActiveColumn('');
    setActiveOperator('');
    setActiveValue([]);
    setExpression([]);
    setError(false);
  };

  const handleSubmit = () => {
    if (anyLine) {
      const preparedFilters = prepareAnyFilterForSet(anyLine);
      dispatch(
        setFiltersAny({ id: currentWorklist.id, data: preparedFilters }),
      );
    }
    if (allLine) {
      const preparedFilters = prepareAllFilterForSet(allLine);
      dispatch(
        setFiltersAll({ id: currentWorklist.id, data: preparedFilters }),
      );
    }

    stateReset();

    dispatch(
      addNotificationAlert({
        title: 'Changes saved',
        description: `Filter for ${
          currentWorklist?.label ?? ''
        } worklist has been saved successfully`,
        type: ENotificationsType.SUCCESS,
      }),
    );
  };

  const handleReset = () => {
    stateReset();
    setAllLine([]);
    setAnyLine([]);
    setAllLine(prepareAllFilterForUi(filtersAll));
    setAnyLine(prepareAnyFilterForUi(filtersAny));
  };

  const handleChangeActiveColumn = (column: ETableColumnAccessor | string) => {
    setActiveColumn(column);
    setActiveOperator('');
    setActiveValue([]);
    setError(false);
  };

  const handleChangeActiveOperator = (operator: EOperators) => {
    setActiveOperator(operator);
    setError(false);
  };

  const handleChangeActiveValue = (
    value: string | number | boolean | string[] | null,
  ) => {
    setActiveValue((prev) => {
      if (prev.includes(value)) {
        return prev.filter((item) => item !== value);
      }
      return [...prev, value];
    });
    setError(false);
  };

  const handleAddExpression = () => {
    const alreadyHasColumnFilter = expression.some((i) =>
      i.includes(
        `${nameByColumn[activeColumn]} ${symbolByOperator[activeOperator]}`,
      ),
    );
    if (alreadyHasColumnFilter) {
      const oldItem = expression.find((i) =>
        i.startsWith(
          `${nameByColumn[activeColumn]} ${symbolByOperator[activeOperator]}`,
        ),
      );

      if (oldItem) {
        const value = activeValue.join(' || ');
        const newItem = `${oldItem} || ${value}`;
        const oldItemPosition = expression.findIndex((i) =>
          i.startsWith(
            `${nameByColumn[activeColumn]} ${symbolByOperator[activeOperator]}`,
          ),
        );

        if (
          expression.includes(newItem) ||
          activeValue.some((i) => oldItem.includes(i as string))
        ) {
          setError(true);
          return;
        }

        setExpression((prev) => {
          const newExpression = prev.filter(
            (_item, index) => index !== oldItemPosition,
          );

          newExpression.splice(oldItemPosition, 0, newItem);

          return newExpression;
        });
      }
    } else {
      const value = activeValue.join(' || ');
      const newItem = `${nameByColumn[activeColumn]} ${symbolByOperator[activeOperator]} ${value}`;

      if (expression.includes(newItem)) {
        setError(true);
        return;
      }

      setExpression((prev) => {
        return [...prev, newItem];
      });
    }
    setError(false);
  };

  const handleRemoveExpression = (expression: string) => {
    setExpression((prev) => {
      if (prev.includes(expression)) {
        return prev.filter((item) => item !== expression);
      }
      return prev;
    });
  };

  const handleApplyExpression = () => {
    if (expression.some((i) => i.includes(' || ')) || expression.length > 1) {
      setAnyLine((prev) => {
        const newExpression = expression.join(` ${EConditionType.AND} `);
        return [...prev, newExpression];
      });
    } else {
      setAllLine((prev) => {
        return [...prev, ...expression];
      });
    }
    setExpression([]);
    setIsChanged(true);
  };

  const handleRemoveFromAnyList = (itemFromAny: string) => {
    setAnyLine((prev) => {
      if (prev.includes(itemFromAny)) {
        return prev.filter((item) => item !== itemFromAny);
      }
      return prev;
    });
    setIsChanged(true);
  };

  const handleRemoveFromAllList = (itemFromAll: string) => {
    setAllLine((prev) => {
      if (prev.includes(itemFromAll)) {
        return prev.filter((item) => item !== itemFromAll);
      }
      return prev;
    });
    setIsChanged(true);
  };

  useEffect(() => {
    !!Object.values(filtersAll ?? {}).length &&
      setAllLine(prepareAllFilterForUi(filtersAll));
    !!filtersAny?.length && setAnyLine(prepareAnyFilterForUi(filtersAny));
  }, [filtersAll, filtersAny]);

  return (
    <Panel
      className="filters-content-wrapper"
      header={
        <div>
          <h3>Setup filters for “{currentWorklist?.label ?? ''}”</h3>
          <Space className="button-wrapper">
            <Button onClick={handleSubmit} type="primary" disabled={!isChanged}>
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
      <div className="params-wrapper">
        <div className="first-row">
          <div className="column">
            <strong>Column</strong>
            <div>
              <ul>
                {allColumns.map((i, index) => (
                  <li
                    key={index}
                    className={activeColumn === i.accessor ? 'active' : ''}
                    onClick={() => handleChangeActiveColumn(i.accessor)}
                  >
                    {getNameByAccessor(i.accessor)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="operator">
            <strong>Operator</strong>
            <div>
              <ul>
                {operatorsByColumn(activeColumn).map((i, index) => (
                  <li
                    key={index}
                    className={activeOperator === i.title ? 'active' : ''}
                    onClick={() => handleChangeActiveOperator(i.title)}
                  >
                    <span>{i.icon}</span>
                    {i.title}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="value">
            <strong>Value</strong>
            <div className={error ? 'error' : ''}>
              <ul>
                {filters?.[activeColumn] &&
                  filters[activeColumn].map((i, index) => (
                    <li
                      key={index}
                      className={activeValue.includes(i) ? 'active' : ''}
                      onClick={() => handleChangeActiveValue(i)}
                    >
                      {i}
                    </li>
                  ))}
              </ul>
            </div>
            {error && (
              <p className="error">
                Values you are trying to add are already in the expression
              </p>
            )}
          </div>
        </div>
        <div className="second-row button-wrapper">
          <Button
            onClick={handleAddExpression}
            type="primary"
            ghost
            icon={<IoIosAdd size={28} color="#8A85FF" />}
            disabled={!(!!activeOperator && !!activeValue.length)}
          >
            Add to expression
          </Button>
        </div>
      </div>
      <div className="expression">
        <div>
          <strong>Expression</strong>
          <div>
            <ul>
              {expression.map((i, index) => (
                <li key={index} className="expression-item">
                  {i}
                  <Button
                    onClick={() => handleRemoveExpression(i)}
                    ghost
                    icon={<MdClose size={24} color="#999999" />}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div>
          <p>
            The relationships for different columns in the expression will be
            treated as AND.
          </p>
          <div className="button-wrapper">
            <Button
              onClick={handleApplyExpression}
              type="primary"
              disabled={!Boolean(expression.length)}
              icon={<BiRightArrowAlt size={28} color="#1C2025" />}
            >
              Apply expression
            </Button>
          </div>
        </div>
      </div>
      <div className="result">
        <div>
          <div className="all">
            <strong>ALL of the lines MUST be true</strong>
            <div>
              <ul>
                {!!allLine.length &&
                  allLine.map((i, index) => {
                    if (!!i) {
                      return (
                        <div key={index}>
                          <li className="expression-item">
                            {i}
                            <Button
                              onClick={() => handleRemoveFromAllList(i)}
                              ghost
                              icon={<MdClose size={24} color="#999999" />}
                            />
                          </li>
                          {index + 1 !== allLine.length && (
                            <span>{EConditionType.AND}</span>
                          )}
                        </div>
                      );
                    }
                  })}
              </ul>
            </div>
          </div>
          <div className="any">
            <strong>ANY value per line MUST be true</strong>
            <div>
              <ul>
                {!!anyLine.length &&
                  anyLine.map((i, index) => {
                    if (!!i) {
                      return (
                        <div key={index}>
                          <li className="expression-item">
                            {i}
                            <Button
                              onClick={() => handleRemoveFromAnyList(i)}
                              ghost
                              icon={<MdClose size={24} color="#999999" />}
                            />
                          </li>
                          {index + 1 !== anyLine.length && (
                            <span>{EConditionType.OR}</span>
                          )}
                        </div>
                      );
                    }
                  })}
              </ul>
            </div>
          </div>
        </div>
        <div className="checkboxes">
          <p>Automatically filter by user:</p>
          <CheckboxGroup className="checkboxes" options={checkboxConfig} />
          {/* {checkboxConfig.map((i, index) => (
            <Checkbox key={index} className="worklist-item" value={i.value}>
              <span>{i.title}</span>
            </Checkbox>
          ))} */}
        </div>
      </div>
    </Panel>
  );
};

export default FiltersContent;
