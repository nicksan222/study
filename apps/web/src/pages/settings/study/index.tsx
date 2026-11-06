import { QuizSettings } from './quiz-settings';
import { StudySettingsView } from './study.view';
import { useStudySettings } from './use-study';

export function StudySettings() {
  return (
    <>
      <StudySettingsView model={useStudySettings()} />
      <QuizSettings />
    </>
  );
}
