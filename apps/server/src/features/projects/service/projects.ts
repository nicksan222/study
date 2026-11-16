/** @file Owns projects within this feature. */

import type {
  createProjectInputSchema,
  projectIdInputSchema,
  projectMaterialInputSchema,
  projectNoteInputSchema,
  projectPageInputSchema,
  renameProjectInputSchema,
  setExamInputSchema,
  setProjectIconInputSchema
} from '@study/contracts';
import { StudyError } from '@study/contracts';

import { ProjectsStore } from '#server/features/projects/store/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';
import { pageById } from '#server/platform/definitions/page-by-id';

function nameOf(value: string) {
  const name = value.trim();

  if (!name || [...name].length > 100)
    throw new StudyError('invalid_input', 'invalid project name');

  return name;
}

function examOf(day: string | null) {
  if (day === null) return null;

  const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(day);

  if (!match) throw new StudyError('invalid_input', 'invalid exam date');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (month < 1 || month > 12 || date < 1 || date > days[month - 1]!)
    throw new StudyError('invalid_input', 'invalid exam date');

  return `${match[1]!.padStart(4, '0')}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
}

export function* projectOperations() {
  const store = yield* useStore(ProjectsStore);

  return {
    addMaterial: (input: typeof projectMaterialInputSchema.Type) =>
      transaction((tx) => tx.store(ProjectsStore).addMaterial(input)),
    removeMaterial: (input: typeof projectMaterialInputSchema.Type) =>
      transaction((tx) => tx.store(ProjectsStore).removeMaterial(input)),
    addNote: (input: typeof projectNoteInputSchema.Type) =>
      transaction((tx) => tx.store(ProjectsStore).addNote(input)),
    removeNote: (input: typeof projectNoteInputSchema.Type) =>
      transaction((tx) => tx.store(ProjectsStore).removeNote(input)),
    project: store.project,
    findProject: store.findProject,
    projects: (input: typeof projectPageInputSchema.Type) => pageById(store.projects, input),
    ensureProject: (input: typeof createProjectInputSchema.Type) =>
      transaction((tx) => tx.store(ProjectsStore).ensureProject({ name: nameOf(input.name) })),
    createProject: (input: typeof createProjectInputSchema.Type) =>
      transaction((tx) => tx.store(ProjectsStore).createProject({ name: nameOf(input.name) })),
    renameProject: (input: typeof renameProjectInputSchema.Type) =>
      transaction((tx) =>
        tx.store(ProjectsStore).renameProject({ ...input, name: nameOf(input.name) })
      ),
    deleteProject: (input: typeof projectIdInputSchema.Type) =>
      transaction((tx) => tx.store(ProjectsStore).deleteProject(input)),
    setIcon: (input: typeof setProjectIconInputSchema.Type) =>
      transaction((tx) => tx.store(ProjectsStore).setIcon(input)),
    setExam: (input: typeof setExamInputSchema.Type) =>
      transaction((tx) =>
        tx.store(ProjectsStore).setExam({ ...input, examOn: examOf(input.examOn) })
      )
  };
}
