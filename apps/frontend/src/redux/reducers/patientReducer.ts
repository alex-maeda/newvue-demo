import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { addMinutes, differenceInYears } from 'date-fns';
import { getPatientListThunk, getPatientThunk } from '../thunks/patientThunk';
import { TPatientReducerInitialState } from '../types/patientTypes';
import { IPatient } from '../../models/Patient';
import { ColorEnum, EPatientMode, PriorityEnum } from '../../models/enums';
import { prepareDOB } from '../../utils/DateUtils';

const calculateTimer = (item: IPatient, defaultTimer: number): number => {
  if (item.timerOverride) {
    console.log(
      `Patient ${item.firstName} ${item.lastName} using timerOverride: ${item.timerOverride}m`,
    );
    return addMinutes(new Date(), item.timerOverride + 1).valueOf();
  }
  return addMinutes(new Date(), defaultTimer).valueOf();
};

export const preparePatientData = (
  data: IPatient[],
  needChangeKeyFormat = true,
): { patients: IPatient[]; priorities: Record<ColorEnum, number> } => {
  let blue = 0;
  let red = 0;
  let orange = 0;
  let yellow = 0;
  let green = 0;
  let purple = 0;
  let color: ColorEnum;
  let timer = 0;
  const patients = data.map((item) => {
    const { priority } = item;
    switch (priority) {
      case PriorityEnum.STROKE:
        blue += 1;
        color = ColorEnum.BLUE;
        timer = 10;
        break;
      case PriorityEnum.ER:
        red += 1;
        color = ColorEnum.RED;
        timer = 50;
        break;
      case PriorityEnum.STAT:
        orange += 1;
        color = ColorEnum.ORANGE;
        timer = 100;
        break;
      case PriorityEnum.HOLD:
        yellow += 1;
        color = ColorEnum.YELLOW;
        timer = 200;
        break;
      case PriorityEnum.INPATIENT:
        green += 1;
        color = ColorEnum.GREEN;
        timer = 300;
        break;
      case PriorityEnum.OUTPATIENT:
        purple += 1;
        color = ColorEnum.PURPLE;
        timer = 400;
        break;
    }
    if (needChangeKeyFormat) {
      const birthDate = new Date(item.DOB);
      const currentDate = new Date();
      const age = differenceInYears(currentDate, birthDate);

      return {
        ...item,
        color,
        timer: calculateTimer(item, timer),
        age: String(age),
        DOB: prepareDOB(item.DOB),
        name: item.firstName + ' ' + item.lastName,
      };
    }
    return {
      ...item,
      timer: calculateTimer(item, timer),
      color,
    };
  });
  return { patients, priorities: { blue, red, yellow, orange, green, purple } };
};

export const initialState: TPatientReducerInitialState = {
  getPatients: {
    count: -1,
    patients: [],
    isFetching: false,
    error: null,
  },

  getPatient: {
    patient: {} as IPatient,
    isFetching: false,
    error: null,
  },

  unexpectedError: null,
};

const PatientReducer = createSlice({
  name: 'Patients',
  initialState,
  reducers: {
    resetPatientsError({ getPatients, getPatient }) {
      getPatients.error = null;
      getPatient.error = null;
    },
    resetPatientStore({ getPatient }) {
      getPatient.patient = {} as IPatient;
    },
    changePatientLock(
      { getPatients },
      action: PayloadAction<{ id: number; sectionId: number }>,
    ) {
      const { id } = action.payload;
      getPatients.patients = getPatients.patients.map((i) => {
        if (i.id === id) return { ...i, lock: true };
        return i;
      });
    },
    changePatientMode(
      { getPatients },
      action: PayloadAction<{ id: number; mode: EPatientMode }>,
    ) {
      const { id, mode } = action.payload;
      getPatients.patients = getPatients.patients.map((i) => {
        if (i.id === id) return { ...i, mode };
        return i;
      });
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getPatientListThunk.pending, ({ getPatients }) => {
        getPatients.isFetching = true;
        getPatients.patients = [];
      })
      .addCase(getPatientListThunk.fulfilled, ({ getPatients }, action) => {
        if (action.payload) {
          const { patients } = preparePatientData(action.payload as IPatient[]);
          getPatients.patients = patients;
          getPatients.count = action.payload.length;
        }
        getPatients.isFetching = false;
      })
      .addCase(getPatientThunk.pending, ({ getPatient }) => {
        getPatient.isFetching = true;
        getPatient.patient = {} as IPatient;
      })
      .addCase(getPatientThunk.fulfilled, ({ getPatient }, action) => {
        if (action.payload) {
          getPatient.patient = action.payload;
        }
        getPatient.isFetching = false;
      });
  },
});

export const {
  resetPatientsError,
  resetPatientStore,
  changePatientLock,
  changePatientMode,
} = PatientReducer.actions;

export default PatientReducer.reducer;
