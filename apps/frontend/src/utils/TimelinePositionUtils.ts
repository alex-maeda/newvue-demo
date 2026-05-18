import { parseISO, differenceInDays } from 'date-fns';

export function getTimelinePositions<T extends { date: string }>(
  array: T[],
  daysInRange: number,
  today: Date,
  stepPercent: number,
) {
  if (!array.length) {
    return [];
  }

  const positionsArr: number[] = [];

  const firstPosition = parseFloat(
    positionForDate(today, daysInRange, parseISO(array[0].date)),
  );
  // Rollback to ensure first event starts at the top (0%)
  const rollback = firstPosition;

  const floatPositions = array.map((item) => {
    const parsedDate = parseFloat(
      positionForDate(today, daysInRange, parseISO(item.date)),
    );

    return parsedDate - rollback;
  });

  // First pass: calculate positions with normal spacing
  for (let i = 0; i < array.length; i++) {
    if (i === 0) {
      positionsArr.push(floatPositions[i]);
      continue;
    }

    if (floatPositions[i] - positionsArr[i - 1] < stepPercent) {
      positionsArr.push(positionsArr[i - 1] + stepPercent);
    } else {
      positionsArr.push(floatPositions[i]);
    }
  }

  // Check if we need to compress to fit within 100%
  const lastPosition = positionsArr[positionsArr.length - 1];
  if (lastPosition > 100) {
    // Redistribute all events evenly across the timeline
    const minSpacing = 8; // Minimum spacing between events
    const availableSpace = 100;
    const totalMinSpacing = (array.length - 1) * minSpacing;

    if (totalMinSpacing < availableSpace) {
      // We can fit all events with minimum spacing
      // Distribute remaining space proportionally
      const remainingSpace = availableSpace - totalMinSpacing;
      const scaleFactor = remainingSpace / (lastPosition - totalMinSpacing);

      const compressedPositions: number[] = [0];
      for (let i = 1; i < array.length; i++) {
        const idealGap = positionsArr[i] - positionsArr[i - 1];
        const compressedGap = Math.max(minSpacing, idealGap * scaleFactor);
        compressedPositions.push(compressedPositions[i - 1] + compressedGap);
      }

      return compressedPositions;
    } else {
      // Use minimum spacing for all events
      return array.map((_, i) => Math.min(i * minSpacing, 100));
    }
  }

  return positionsArr;
}

function positionForDate(today: Date, daysInRange: number, date: Date) {
  const dayDifference = differenceInDays(today, date);

  return `${(dayDifference / daysInRange) * 100}`;
}
