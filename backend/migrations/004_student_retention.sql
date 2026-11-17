ALTER TABLE students
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX students_retention_idx
  ON students (school_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

