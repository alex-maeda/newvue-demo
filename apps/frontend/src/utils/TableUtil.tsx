import React from 'react';
import { ETableColumnAccessor } from '../models/enums';

const addBoldText = (
  arr: [string, string],
  boldText: JSX.Element,
): (string | JSX.Element)[] | string => {
  const firstEl = arr[0].trim();
  const secondEl = arr[1].trim();
  const text = boldText.props.children;
  switch (true) {
    case arr[0] === '' && arr[1] === '':
      return [boldText];
    case arr[0] === '':
      return [
        boldText,
        arr[1].startsWith(' ') || text.endsWith(' ') ? (
          <React.Fragment key={Math.random() * 100}>&nbsp;</React.Fragment>
        ) : (
          ''
        ),
        secondEl,
      ];
    case arr[1] === '':
      return [
        firstEl,
        arr[0].endsWith(' ') || text.startsWith(' ') ? (
          <React.Fragment key={Math.random() * 100}>&nbsp;</React.Fragment>
        ) : (
          ''
        ),
        boldText,
      ];
    default:
      return [
        firstEl,
        arr[0].endsWith(' ') ? (
          <React.Fragment key={Math.random() * 100}>&nbsp;</React.Fragment>
        ) : (
          ''
        ),
        boldText,
        arr[1].startsWith(' ') ? (
          <React.Fragment key={Math.random() * 100}>&nbsp;</React.Fragment>
        ) : (
          ''
        ),
        secondEl,
      ];
  }
};

export const highlightText = (
  value: string,
  searchQuery: string,
): (string | JSX.Element)[] | string => {
  const regexp = new RegExp(searchQuery.trim(), 'i');
  if (typeof value === 'string') {
    const matcher = value.match(regexp);
    if (matcher && searchQuery && value) {
      const boldText = matcher[0];
      const res = value.replace(regexp, '!*!').split('!*!');
      const arrWithPlaceForBoldText: [string, string] = [res[0], res[1]];
      return addBoldText(
        arrWithPlaceForBoldText,
        <b key={Math.random() * 100}>{boldText}</b>,
      );
    }
  }
  return value;
};

export const getCellValue = (
  value: string,
  searchQuery: string | number | number[] | null,
) => {
  if (typeof searchQuery === 'string') {
    return highlightText(value, searchQuery ?? '');
  }
  return value;
};

export const getNameByAccessor = (value: string): string => {
  const key = value as keyof typeof ETableColumnAccessor;
  return ETableColumnAccessor[key] || '';
};

export const isIconClick = (target: HTMLElement) => {
  const { dataset } = target;

  if (dataset.icon === 'table-button-icon') {
    return true;
  }

  return false;
};
