CREATE TABLE class_memberships (
  school_id uuid NOT NULL,
  user_id uuid NOT NULL,
  class_group_id uuid NOT NULL,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, user_id, class_group_id),
  FOREIGN KEY (school_id, user_id) REFERENCES school_memberships(school_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, class_group_id) REFERENCES class_groups(school_id, id) ON DELETE CASCADE
);
CREATE INDEX class_memberships_user_idx ON class_memberships(school_id, user_id);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  student_id uuid NOT NULL,
  class_group_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, class_group_id) REFERENCES class_groups(school_id, id),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX enrollments_one_active_per_student_idx ON enrollments(school_id, student_id) WHERE end_date IS NULL;
CREATE INDEX enrollments_student_history_idx ON enrollments(school_id, student_id, start_date DESC);

INSERT INTO enrollments (id, school_id, student_id, class_group_id, start_date)
SELECT gen_random_uuid(), school_id, id, class_group_id, created_at::date
FROM students WHERE class_group_id IS NOT NULL;

