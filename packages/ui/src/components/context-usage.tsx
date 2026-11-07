import { Tooltip, TooltipTrigger, TooltipPopup } from './tooltip';

/** A compact, accessible ring for a bounded context or resource budget. */
export function ContextUsage({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = Math.min(100, Math.max(0, Math.round((value / Math.max(1, max)) * 100)));

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              opacity="0.2"
            />
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              pathLength="100"
              strokeDasharray={`${percent} 100`}
              strokeLinecap="round"
              transform="rotate(-90 12 12)"
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
