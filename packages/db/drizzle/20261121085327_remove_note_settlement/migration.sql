DROP TABLE `note_sidebar_preferences`;
--> statement-breakpoint
DELETE FROM preferences WHERE scope = 'sidebar' AND key = 'settledPageThreshold';
--> statement-breakpoint
DELETE FROM preferences WHERE scope = 'appearance' AND key = 'showNoteComposer';
--> statement-breakpoint
DELETE FROM preferences WHERE scope = 'workspace' AND key = 'sidebarShowPageCounts';
