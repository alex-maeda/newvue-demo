import { EStorageKeys } from '../models/enums';

export const setStorage = <T>(
  key: string,
  initialValue: { [key: string]: unknown } | string | number | boolean | T,
): void => {
  window.localStorage.setItem(key, JSON.stringify(initialValue));
};

export const getStorage = <T>(
  key: string,
): { [key: string]: string } | T | string | boolean | undefined => {
  const storageDataByKey = window.localStorage.getItem(key);
  if (!storageDataByKey) {
    return undefined;
  }
  let result = '';
  try {
    result = JSON.parse(storageDataByKey);
  } catch (e) {
    if (
      e instanceof SyntaxError &&
      (typeof storageDataByKey === 'string' ||
        typeof storageDataByKey === 'boolean')
    ) {
      result = storageDataByKey;
    } else {
      throw e;
    }
  }
  return result;
};

export const removeStorage = (key: string): void => {
  window.localStorage.removeItem(key);
};

export const checkStorage = (key: string) => {
  const storageDataByKey = window.localStorage.getItem(key);
  return !!storageDataByKey;
};

export const clearStorage = (): void => {
  // const userName = getStorage(EStorageKeys.USERNAME) as string;
  removeStorage(EStorageKeys.TOKENS);
  removeStorage(EStorageKeys.USERNAME);
  removeStorage(EStorageKeys.NAME);
};
