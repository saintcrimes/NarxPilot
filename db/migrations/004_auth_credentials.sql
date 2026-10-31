CREATE TABLE auth_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  email text NOT NULL UNIQUE CHECK (email=lower(email) AND email=btrim(email)),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON auth_credentials FROM PUBLIC;
