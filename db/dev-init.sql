-- Local dev only: runtime role that is subject to row-level security.
CREATE ROLE safetab_app LOGIN PASSWORD 'safetab_app_dev_only' NOSUPERUSER NOBYPASSRLS;
