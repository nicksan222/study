import type * as schema from '@study/db/schema';

export function projectRow(row: typeof schema.projects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    examOn: row.exam_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function sessionRow(row: typeof schema.sessions.$inferSelect) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    titleSource: row.title_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
