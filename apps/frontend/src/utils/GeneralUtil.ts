import { theme } from 'antd';

export const MENU_WIDTH_COLLAPSE = 64;
export const MENU_WIDTH_EXPAND = 200;
export const DEFAULT_MIN_COLUMN_WIDTH = 100;
export const DEFAULT_MIN_COLUMN_TABLE_HEIGHT = 48;
export const TIMER_RELOAD_TIME = 60 * 1000;

export const defaultSortFn = (a: string, b: string) => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

export const PATIENT_LINK_READ_AI =
  'https://app-stg.radai.com/report/01JA5D902TXYYNT3MA68AB3CY8';

export const configTheme = (isKonicaBranding: boolean) => ({
  // 1. Use dark algorithm
  algorithm: theme.darkAlgorithm,
  components: {
    Button: {
      colorTextLightSolid: '#1C2025',
      colorBorder: '#383E48',
      colorBgContainer: '#1C2025',
    },
    Input: {
      colorBorder: '#383E48',
      colorBgContainer: '#1C2025',
    },
    InputNumber: {
      colorBorder: '#383E48',
      colorBgContainer: '#1C2025',
    },
    Select: {
      colorBorder: '#383E48',
      colorBgContainer: '#1C2025',
    },
    DatePicker: {
      colorBorder: '#383E48',
      colorBgContainer: '#1C2025',
    },
    Checkbox: {
      colorPrimary: isKonicaBranding ? '#0068b4' : '#8a85ff',
      colorTextLightSolid: isKonicaBranding ? '#009cbd' : '#A1D103',
      algorithm: true, // Enable algorithm
    },
    Tabs: {
      colorPrimary: isKonicaBranding ? '#0068b4' : '#8a85ff',
      horizontalItemGutter: 0,
    },
    Avatar: {
      groupSpace: 2,
      groupOverlapping: -22,
    },
    Dropdown: {
      colorBgElevated: '#1C2025',
      fontSize: 16,
      controlPaddingHorizontal: 16,
      controlHeight: 44,
    },
    Slider: {
      trackBg: isKonicaBranding ? '#004499' : '#535099',
      handleColor: isKonicaBranding ? '#004499' : '#535099',
      handleActiveColor: isKonicaBranding ? '#0068b4' : '#8A85FF',
      dotBorderColor: isKonicaBranding ? '#0068b4' : '#8A85FF',
      trackHoverBg: isKonicaBranding ? '#0068b4' : '#8A85FF',
      railBg: '#383E48',
      railHoverBg: '#383E48',
      colorText: '#ffffff',
      handleLineWidth: 2,
      handleLineWidthHover: 2,
      handleSize: 6,
      handleSizeHover: 8,
    },
    Switch: {
      controlHeight: 40,
    },
  },
  token: {
    colorPrimary: isKonicaBranding ? '#0068b4' : '#8A85FF',
    colorLink: isKonicaBranding ? '#0068b4' : '#8A85FF',
  },
});

export const defaultPriorities = {
  blue: 0,
  red: 0,
  yellow: 0,
  orange: 0,
  green: 0,
  purple: 0,
};

export const getPatientLink = (
  mrn: string,
  accession: string,
  patientLink?: string,
) => {
  return (
    patientLink ||
    `https://demo3.mach7t.com:18888/e/viewer?patient_id=${mrn}&accession_number=${accession}&viewFromList=e&serviceInstance=MACH7&serviceInstanceParameter=&viewerMonitors=2&user=nvlaunch&password=newvue&studyStatus=NEW`
  );
};
