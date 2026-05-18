/**
 * TimelineSection — Year-group container with a sticky label.
 *
 * Groups prior studies by year and renders a sticky header
 * that remains visible while scrolling within that group.
 */

import type { ReactNode } from 'react';
import './TimelineSection.css';

interface TimelineSectionProps {
  year: string;
  studyCount: number;
  children: ReactNode;
}

export function TimelineSection({ year, studyCount, children }: TimelineSectionProps) {
  return (
    <section className="timeline-section">
      <div className="ts-header">
        <span className="ts-year">{year}</span>
        <span className="ts-count">{studyCount}</span>
        <span className="ts-line" />
      </div>
      <div className="ts-cards">
        {children}
      </div>
    </section>
  );
}
