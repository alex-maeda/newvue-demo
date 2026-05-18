import {
  formatDistanceToNowStrict,
  parse,
  format,
  differenceInMinutes,
} from 'date-fns';

export const getPatientsAge = (DOB: string) => {
  if (!DOB) {
    return '';
  }
  const birthday = parse(DOB, 'yyyy/MM/dd', new Date());
  const age = formatDistanceToNowStrict(birthday, { unit: 'year' });
  return age;
};

export const formateDate = (date: string) => {
  return format(new Date(date), 'MM/dd/yyyy');
};

export const formateDateTime = (date: string) => {
  return format(new Date(date), 'MM/dd/yyyy hh:mm a');
};

export const prepareDOB = (DOB: string) => {
  const dateObj = parse(DOB, 'yyyy-MM-dd', new Date());
  return format(dateObj, 'yyyy/MM/dd');
};

export const preparePatientDOB = (DOB: string) => {
  const dateObj = parse(DOB, 'yyyy-MM-dd', new Date());
  return format(dateObj, 'MM/dd/yyyy');
};

// export const minutesToFormattedTime = (minutes: number) => {
//   const days = Math.floor(minutes / (24 * 60));
//   const remainingMinutes = minutes % (24 * 60);
//   const hours = Math.floor(remainingMinutes / 60);
//   const formattedMinutes = remainingMinutes % 60;

//   const formattedTime = `${days}d. ${hours
//     .toString()
//     .padStart(2, '0')}:${formattedMinutes.toString().padStart(2, '0')}`;
//   return formattedTime;
// };

export const minutesToFormattedTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const formattedMinutes = minutes % 60;

  const hoursString = `${hours}H`;
  const minutesString = `${formattedMinutes}M`;
  return { hoursString, minutesString };
};

export const getDeltaTimeToNow = (date: number) => {
  const delta = differenceInMinutes(new Date(date), new Date());
  return delta;
};
