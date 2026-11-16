import type { Locale } from './catalog.ts';
import { questionNumber, reviewProgress, questionCount } from './counts.ts';
import { createLocalization } from './i18n.ts';

/** Localized copy and number formatting for the shared practice presentations. */
export function createPracticePresentation(locale: Locale) {
  const { t } = createLocalization(locale);
  const percentage = new Intl.NumberFormat(locale === 'italian' ? 'it' : 'en', {
    style: 'percent',
    maximumFractionDigits: 0
  });

  return {
    t,
    questionNumber: (index: number) => questionNumber(locale, index),
    reviewProgress: (completed: number, total: number) => reviewProgress(locale, completed, total),
    questionCount: (count: number) => questionCount(locale, count),
    percentage: (score: number) => percentage.format(score)
  };
}
