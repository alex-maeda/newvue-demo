export interface Props {
  children: React.ReactNode;
}

export interface State {
  hasError: boolean;
  stack: string | undefined;
  message: string | undefined;
  status?: number;
}
