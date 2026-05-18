import { EPositionWorkListController } from '../../models/enums';

export interface IWorklistController {
  specificList: string[];
  displayMode: string;
  expanded: boolean;
  position: EPositionWorkListController;
  isShowControllerBlock: boolean;
}

export interface IToolBarSettingsInitialState {
  worklistController: IWorklistController;
  controllerPosition: { top: number; left: number };
}
