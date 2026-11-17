ALTER TABLE users
  ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_secret_enc text,
  ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;

ALTER TABLE users
  ADD CONSTRAINT users_mfa_secret_required CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL);

