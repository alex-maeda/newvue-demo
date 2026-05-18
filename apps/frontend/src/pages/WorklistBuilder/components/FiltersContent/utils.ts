import { IFiltersConfig } from '../../../../redux/types/adminSettingsTypes';

import { IPatient, IPatientsNote } from '../../../../models/Patient';
import { EConditionType, EOperators } from '../../../../models/enums';

interface ICheckboxConfig {
  label: string;
  value: string;
}

interface IOperatorsConfig {
  icon: string;
  title: EOperators;
}

interface IParams {
  value:
    | string
    | number
    | boolean
    | number[]
    | string[]
    | IPatientsNote[]
    | undefined;
  targetValue: Array<string | number>;
}

interface IFieldValue extends Omit<IParams, 'targetValue'> {}

export const checkboxConfig: ICheckboxConfig[] = [
  {
    label: 'Specialty',
    value: 'specialty',
  },
  {
    label: 'Insurance',
    value: 'insurance',
  },
  {
    label: 'Credentials',
    value: 'credentials',
  },
  {
    label: 'Facility',
    value: 'facility',
  },
];

export const operatorsByColumn = (columnName: string) => {
  if (columnName === 'age') {
    return [...operatorsTypeConfig, ...operatorsOnlyNumberTypeConfig];
  }
  return operatorsTypeConfig;
};

export const symbolByOperator: Record<string, string> = {
  [EOperators.EQUALS]: '==',
  [EOperators.CONTAINS]: '[...]',
  [EOperators.STARTS_WITH]: '[...',
  [EOperators.ENDS_WITH]: '...]',
  [EOperators.DOES_NOT_CONTAINS]: '![...]',
  [EOperators.DOES_NOT_EQUAL]: '!==',
  [EOperators.LESS_THAN_OR_EQUAL_TO]: '<=',
  [EOperators.LESS_THAN]: '<',
  [EOperators.GREATER_THAN_OR_EQUAL_TO]: '>=',
  [EOperators.GREATER_THAN]: '>',
};

export const nameByColumn: Record<string, string> = {
  examStatus: 'EXAM STATUS',
  examDescription: 'EXAM DESCRIPTION',
  modality: 'MODALITY',
  name: 'PATIENT NAME',
  age: 'PATIENT AGE',
  examCompleted: 'EXAM COMPLETED',
  orderLocation: 'ORDER LOCATION',
  clinicalIndications: 'CLINICAL INDICATIONS',
  reasonForExam: 'REASON FOR EXAM',
  specialty: 'SPECIALTY',
  bodyPart: 'BODY PART',
  accession: 'ACCESSION',
  MRN: 'MRN',
  facilityName: 'FACILITY NAME',
  orderedBy: 'ORDERED BY',
  referredBy: 'REFERRED BY',
  performedBy: 'PERFORMED BY',
  orderedLocation: 'ORDERED LOCATION',
  assignedTo: 'ASSIGNED TO',
  facilityCode: 'FACILITY CODE',
  insurancePlan: 'INSURANCE PLAN',
  currentPatientLocation: 'CURRENT PATIENT LOCATION',
};

export const operatorsTypeConfig: IOperatorsConfig[] = [
  {
    icon: symbolByOperator[EOperators.EQUALS],
    title: EOperators.EQUALS,
  },
  {
    icon: symbolByOperator[EOperators.CONTAINS],
    title: EOperators.CONTAINS,
  },
  {
    icon: symbolByOperator[EOperators.STARTS_WITH],
    title: EOperators.STARTS_WITH,
  },
  {
    icon: symbolByOperator[EOperators.ENDS_WITH],
    title: EOperators.ENDS_WITH,
  },
  {
    icon: symbolByOperator[EOperators.DOES_NOT_CONTAINS],
    title: EOperators.DOES_NOT_CONTAINS,
  },
  {
    icon: symbolByOperator[EOperators.DOES_NOT_EQUAL],
    title: EOperators.DOES_NOT_EQUAL,
  },
];

export const operatorsOnlyNumberTypeConfig: IOperatorsConfig[] = [
  {
    icon: symbolByOperator[EOperators.LESS_THAN_OR_EQUAL_TO],
    title: EOperators.LESS_THAN_OR_EQUAL_TO,
  },
  {
    icon: symbolByOperator[EOperators.LESS_THAN],
    title: EOperators.LESS_THAN,
  },
  {
    icon: symbolByOperator[EOperators.GREATER_THAN_OR_EQUAL_TO],
    title: EOperators.GREATER_THAN_OR_EQUAL_TO,
  },
  {
    icon: symbolByOperator[EOperators.GREATER_THAN],
    title: EOperators.GREATER_THAN,
  },
];

export const getOperatorBySymbol = (symbol: string) => {
  for (const operator in symbolByOperator) {
    if (symbolByOperator[operator] === symbol) {
      return operator;
    }
  }
  return '';
};

export const prepareAllFilterForSet = (array: string[]) => {
  const resultObject: IFiltersConfig = {};

  array.forEach((str) => {
    const regex =
      /(\w+)\s?([=!<>]+|\[\.\.\.\]|\[\.\.\.\]|\[\.\.\.|\.\.\.\]|!\[\.\.\.\])\s?(\w+)/g;

    let separator = '';
    const replacedString = str.replace(regex, (match, p1, p2, p3) => {
      for (const operator in symbolByOperator) {
        if (symbolByOperator[operator] === p2) {
          separator = operator;
          return `${p1} ${operator} ${p3}`;
        }
      }
      return match;
    });
    const parts = replacedString.split(` ${separator} `);
    const name = parts[0];
    const value = parts[1]?.split(' || ');

    if (!resultObject[name]) {
      resultObject[name] = {};
    }

    resultObject[name][separator] = [
      ...(resultObject[name][separator] ?? []),
      ...value,
    ];
  });

  return resultObject;
};

export const prepareAnyFilterForSet = (array: string[]) => {
  const resultArray: IFiltersConfig[] = [];
  const newArray = array.map((i) => i.split(` ${EConditionType.AND} `));

  newArray.forEach((i) => {
    const preparedFilters = prepareAllFilterForSet(i);
    resultArray.push(preparedFilters);
  });

  return resultArray;
};

export const prepareAllFilterForUi = (filters: IFiltersConfig) => {
  const resultArray = [];

  for (const key in filters) {
    const columnName = nameByColumn[key];
    const filterObject = filters[key];

    for (const operator in filterObject) {
      const operatorSymbol = symbolByOperator[operator];

      if (operatorSymbol) {
        const values = filterObject[operator];
        const valuesString = values.join(' || ');
        const filterString = `${columnName} ${operatorSymbol} ${valuesString}`;
        resultArray.push(filterString);
      }
    }
  }
  return resultArray;
};

export const prepareAnyFilterForUi = (filters: IFiltersConfig[]) => {
  const resultArray = filters.map((filterObject) => {
    const filterStrings = Object.keys(filterObject).map((key) => {
      const columnName = nameByColumn[key];
      const filter = filterObject[key];
      const filterStrings = Object.keys(filter).map((operator) => {
        const operatorSymbol = symbolByOperator[operator];
        const values = filter[operator].join(' || ');
        return `${columnName} ${operatorSymbol} ${values}`;
      });
      return filterStrings.join(` ${EConditionType.AND} `);
    });
    return filterStrings.join(` ${EConditionType.AND} `);
  });
  return resultArray;
};

export const filterPatients = (
  patient: IPatient,
  filterOptions: IFiltersConfig,
): boolean => {
  const updatePatient = { ...patient, age: parseInt(patient.age ?? '') };
  let matchesAllConditions = true;

  for (const field in filterOptions) {
    if (filterOptions.hasOwnProperty(field)) {
      const fieldConditions = filterOptions[field];
      const fieldValue: IFieldValue = {
        value: updatePatient[field as keyof IPatient],
      };

      for (const operator in fieldConditions) {
        if (fieldConditions.hasOwnProperty(operator)) {
          const values = fieldConditions[operator];

          if (
            !matchesCondition[operator as EOperators]({
              value: fieldValue.value,
              targetValue: values,
            })
          ) {
            matchesAllConditions = false;
            break;
          }
        }
      }
    }
  }

  return matchesAllConditions;
};

export const filteredAllPatients = (
  patients: IPatient[],
  filterOptions: IFiltersConfig,
): IPatient[] => {
  if (!Object.values(filterOptions).length) {
    return patients;
  }
  return patients.filter((patient) => filterPatients(patient, filterOptions));
};

export const filteredAnyPatients = (
  patient: IPatient,
  filterOptions: IFiltersConfig[],
): boolean => {
  let matchesAnyConditions = false;
  for (let j = 0; j < filterOptions.length; j++) {
    const filterItem = filterOptions[j];
    matchesAnyConditions = filterPatients(patient, filterItem);

    if (matchesAnyConditions) {
      break;
    }
  }
  return matchesAnyConditions;
};

const matchesCondition: Record<EOperators, (params: IParams) => boolean> = {
  [EOperators.EQUALS]: ({ value, targetValue }: IParams) => {
    return targetValue.some((i) => i == value);
  },
  [EOperators.CONTAINS]: ({ value, targetValue }: IParams) => {
    return targetValue.includes(String(value));
  },
  [EOperators.STARTS_WITH]: ({ value, targetValue }: IParams) => {
    return targetValue.some((i) => String(i).startsWith(String(value)));
  },
  [EOperators.ENDS_WITH]: ({ value, targetValue }: IParams) => {
    return targetValue.some((i) => String(i).endsWith(String(value)));
  },
  [EOperators.DOES_NOT_CONTAINS]: ({ value, targetValue }: IParams) => {
    return !targetValue.includes(String(value));
  },
  [EOperators.DOES_NOT_EQUAL]: ({ value, targetValue }: IParams) => {
    return targetValue.some((i) => i != value ?? '');
  },
  [EOperators.LESS_THAN_OR_EQUAL_TO]: ({ value, targetValue }: IParams) => {
    return targetValue.some((i) => +i >= +(value ?? ''));
  },
  [EOperators.LESS_THAN]: ({ value, targetValue }: IParams) => {
    return targetValue.some((i) => +i > +(value ?? ''));
  },
  [EOperators.GREATER_THAN_OR_EQUAL_TO]: ({ value, targetValue }: IParams) => {
    return targetValue.some((i) => +i <= +(value ?? ''));
  },
  [EOperators.GREATER_THAN]: ({ value, targetValue }: IParams) => {
    return targetValue.some((i) => +i < +(value ?? ''));
  },
};
