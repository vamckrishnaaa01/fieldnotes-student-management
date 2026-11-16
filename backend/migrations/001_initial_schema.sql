CREATE TABLE schools (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 160),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE school_memberships (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'teacher', 'attendance_staff', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, user_id)
);

CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL,
  school_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, user_id) REFERENCES school_memberships(school_id, user_id) ON DELETE CASCADE
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE class_groups (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 24),
  year_group smallint NOT NULL CHECK (year_group BETWEEN 1 AND 12),
  academic_year text NOT NULL CHECK (length(academic_year) BETWEEN 4 AND 20),
  teacher_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (school_id, academic_year, name)
);

CREATE TABLE students (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_group_id uuid,
  student_number text NOT NULL CHECK (length(student_number) BETWEEN 1 AND 40),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 160),
  year_group smallint NOT NULL CHECK (year_group BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'withdrawn', 'graduated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, class_group_id) REFERENCES class_groups(school_id, id),
  UNIQUE (school_id, id),
  UNIQUE (school_id, student_number)
);
CREATE INDEX students_school_name_idx ON students(school_id, lower(full_name));
CREATE INDEX students_school_class_idx ON students(school_id, class_group_id) WHERE status = 'enrolled';

CREATE TABLE attendance_sessions (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_group_id uuid NOT NULL,
  attendance_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, class_group_id) REFERENCES class_groups(school_id, id),
  UNIQUE (school_id, id),
  UNIQUE (school_id, class_group_id, attendance_date)
);

CREATE TABLE attendance_records (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  session_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, session_id) REFERENCES attendance_sessions(school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
  UNIQUE (session_id, student_id)
);

CREATE TABLE calendar_events (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  event_date date NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, id)
);
CREATE INDEX calendar_events_school_date_idx ON calendar_events(school_id, event_date);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 80),
  entity_id uuid,
  request_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_school_created_idx ON audit_events(school_id, created_at DESC);

CREATE TABLE schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

