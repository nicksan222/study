import type { MaterialSummaryDto, NoteDto, Project, searchResultSchema } from '@study/contracts';

export type Subjects = readonly Project[];

export type Notes = readonly NoteDto[];

export type Materials = readonly MaterialSummaryDto[];

export type SearchResults = typeof searchResultSchema.Type;
