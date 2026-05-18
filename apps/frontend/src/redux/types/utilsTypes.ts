import { EChatType } from '../../models/enums';

export interface TUtilsInitialState {
  hotKey: string;
  isExpandedSidebar: boolean;
  isExpandChatArea: boolean;
  chatActiveType: EChatType;

  isKonicaBranding: boolean;
}
