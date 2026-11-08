import { createRef } from 'react';

import type { SidebarModel } from '../app/shell/use-sidebar';

const noop = () => {};

export function sidebarModel(): SidebarModel {
  return {
    replay: null,
    settingsProject: undefined,
    setSettingsProject: noop,
    metadata: { title: 'Notes', section: 'notes', scope: 'project' },
    collapsed: false,
    onToggle: noop,
    requestedProject: null,
    global: false,
    section: 'notes',
    subjects: [],
    subject: undefined,
    subjectState: 'ready',
    project: undefined,
    invalidSubject: false,
    notes: [],
    noteState: 'ready',
    pickerOpen: false,
    setPickerOpen: noop,
    query: '',
    setQuery: noop,
    newSubjectOpen: false,
    setNewSubjectOpen: noop,
    name: '',
    setName: noop,
    actionError: false,
    setActionError: noop,
    creating: false,
    searchRef: createRef<HTMLInputElement>(),
    canSearch: true,
    result: undefined,
    hits: [],
    openSearch: noop,
    clearSearch: noop,
    selectSubject: noop,
    createNote: async () => {},
    createSubject: async () => {},
    reloadSubjects: noop,
    reloadNotes: noop
  };
}
