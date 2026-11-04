-- The already-applied authored copy migration copies asset rows explicitly. Suspend automatic
-- derivation within the migrator transaction, then restore it in seal-authored-evidence.
DROP TRIGGER document_asset_insert;
--> statement-breakpoint
CREATE TRIGGER document_asset_insert AFTER INSERT ON blocks WHEN 0 BEGIN SELECT 1; END;
