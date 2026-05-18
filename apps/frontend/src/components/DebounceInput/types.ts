export interface DebounceInputProps {
  onChange: (val: string) => void;
  onPressEnter?: () => void | null;
  value: string;
  minLength?: number;
  dataQa?: string;
  inputDelay?: number;
  inputDataFilter?: RegExp;
  placeholder?: string;
}
