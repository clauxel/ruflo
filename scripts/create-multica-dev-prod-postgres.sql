\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'multica_dev') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', 'multica_dev', :'dev_password');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', 'multica_dev', :'dev_password');
  END IF;
END
$$;

SELECT format('CREATE DATABASE %I OWNER %I', 'multica_dev', 'multica_dev')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'multica_dev')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', 'multica_dev', 'multica_dev')
\gexec

\connect multica_dev

ALTER SCHEMA public OWNER TO multica_dev;
GRANT ALL ON SCHEMA public TO multica_dev;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO multica_dev;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO multica_dev;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO multica_dev;

\connect postgres

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'multica_prod') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', 'multica_prod', :'prod_password');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', 'multica_prod', :'prod_password');
  END IF;
END
$$;

SELECT format('CREATE DATABASE %I OWNER %I', 'multica_prod', 'multica_prod')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'multica_prod')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', 'multica_prod', 'multica_prod')
\gexec

\connect multica_prod

ALTER SCHEMA public OWNER TO multica_prod;
GRANT ALL ON SCHEMA public TO multica_prod;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO multica_prod;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO multica_prod;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO multica_prod;
