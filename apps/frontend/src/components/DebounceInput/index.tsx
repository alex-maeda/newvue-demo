import {
  FC,
  useCallback,
  useEffect,
  useRef,
  useState,
  ChangeEvent,
} from 'react';
import { debounce } from 'lodash';
import { DebounceInputProps } from './types';
import { Input } from 'antd';

const DebounceInput: FC<DebounceInputProps> = (props) => {
  const {
    onChange,
    onPressEnter = () => null,
    value,
    inputDelay = 1000,
    minLength = 2,
    inputDataFilter,
    placeholder,
  } = props;
  const [inputVal, setInputVal] = useState('');
  const inputValRef = useRef('');

  useEffect(() => {
    setInputVal(value);
    inputValRef.current = value;
  }, [value]);

  const handleChangeInput = () => {
    const text = inputValRef.current;
    if (text.length >= minLength) {
      onChange(text);
    }
  };

  const debouncedHandleChange = useCallback(
    debounce(handleChangeInput, inputDelay),
    [],
  );

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const preparedVal = inputDataFilter
      ? val.replaceAll(inputDataFilter, '')
      : val;

    inputValRef.current = preparedVal;
    setInputVal(preparedVal);

    const inputValLength = inputVal.length;
    const inputValRefLength = inputValRef.current.length;

    if (inputValRefLength === 0 && inputValLength > 0) {
      setInputVal('');
      inputValRef.current = '';
      onChange('');
    }

    if (inputValRefLength >= minLength) {
      debouncedHandleChange();
    }
  };

  return (
    <Input
      id="search"
      autoComplete="off"
      value={inputVal}
      onChange={handleChange}
      placeholder={placeholder}
      onPressEnter={onPressEnter}
    />
  );
};

export default DebounceInput;
