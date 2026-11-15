import type { MaterialSummaryDto } from '@study/contracts/materials/schemas';
import type { NoteDto } from '@study/contracts/notes/schemas';
import type { Project } from '@study/contracts/projects/schemas';
import type { searchResultSchema } from '@study/contracts/system/schemas';

export type Subjects = readonly Project[];

export type Notes = readonly NoteDto[];

export type Materials = readonly MaterialSummaryDto[];

export type SearchResults = typeof searchResultSchema.Type;
