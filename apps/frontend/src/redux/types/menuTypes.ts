import { IPatient } from '../../models/Patient';
import { ENoteType, EWheelMenuItemName } from '../../models/enums';

export interface IMenuProps {
  x: number;
  y: number;
  info: IPatient;
}

export interface INoteModal extends IMenuProps {
  type: ENoteType;
}

export interface TMenuReducerInitialState {
  menuProps: IMenuProps | null;
  documentListProps: IMenuProps | null;
  noteProps: INoteModal | null;
  openedMenu: EWheelMenuItemName | '';
  isFetching: boolean;
  currentPatientId: string;
}
