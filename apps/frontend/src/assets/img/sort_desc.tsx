export const descSortIcon = (isKonicaBranding: boolean) => {
  const color = isKonicaBranding ? '#0068b4' : '#8A85FF';

  return (
    <svg
      width="20"
      height="20"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 10 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.21828 8.72637C1.98734 8.32637 2.27602 7.82637 2.7379 7.82637L6.5438 7.82637C7.00568 7.82637 7.29436 8.32637 7.06342 8.72637L5.16047 12.0224C4.92953 12.4224 4.35218 12.4224 4.12124 12.0224L2.21828 8.72637Z"
        fill="#999999"
      />
      <path
        d="M7.06345 5.43964C7.29439 5.83964 7.00572 6.33964 6.54384 6.33964L2.73793 6.33964C2.27605 6.33964 1.98738 5.83964 2.21832 5.43964L4.12127 2.14363C4.35221 1.74363 4.92956 1.74363 5.1605 2.14363L7.06345 5.43964Z"
        fill={color}
      />
    </svg>
  );
};
