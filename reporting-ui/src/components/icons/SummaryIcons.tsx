/**
 * SummaryIcons — Monochromatic SVG icons for AI summary features.
 *
 * Styled to match the reporting hamburger menu icons:
 *   - 24×24 viewBox, stroke-based, rounded caps/joins
 *   - Colored via CSS `color` property (uses `currentColor`)
 *   - Default color: var(--color-interactive-t2) (NewVue purple)
 *
 * Usage:
 *   <SparkleIcon className="my-icon" />
 *   <SearchIcon className="my-icon" />
 *   <CheckboxIcon className="my-icon" />
 */

interface IconProps {
  className?: string;
  size?: number;
}

/**
 * Sparkle — Three 4-point stars (large + medium + small).
 * Used for: AI Summary headers (left-rail + executive summary).
 */
export function SparkleIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <path d="M10,21.236,6.755,14.745.264,11.5,6.755,8.255,10,1.764l3.245,6.491L19.736,11.5l-6.491,3.245ZM18,21l1.5,3L21,21l3-1.5L21,18l-1.5-3L18,18l-3,1.5ZM19.333,4.667,20.5,7l1.167-2.333L24,3.5,21.667,2.333,20.5,0,19.333,2.333,17,3.5Z" />
    </svg>
  );
}

/**
 * Search — Magnifying glass with circular lens.
 * Used for: Similar Prior Presentations section.
 */
export function SearchIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

/**
 * Checkbox — Rounded square with checkmark.
 * Used for: Open Recommendations section (replaces lightning bolt).
 */
export function CheckboxIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 12l2.5 2.5L16 9" />
    </svg>
  );
}

/**
 * SectionChevron — Right-angle chevron (>) for collapsible section bars.
 * Points right by default; rotated via CSS for open/closed states.
 * Used for: Collapsible executive summary title bars.
 */
export function SectionChevronIcon({ className, size = 14 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/**
 * QuestionCircle — Circle with a centered question mark.
 * Used for: Reason for Study section header.
 * Based on Lucide circle-help icon.
 */
export function QuestionCircleIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * Hourglass — Stylized hourglass (Lucide-inspired).
 * Used for: Open Recommendations status indicator.
 */
export function HourglassIcon({ className, size = 14 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </svg>
  );
}
