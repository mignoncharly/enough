-- Development only. This creates the role and database from .env.example.
SELECT 'CREATE ROLE enough LOGIN PASSWORD ''enough'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enough') \gexec

SELECT 'CREATE DATABASE enough OWNER enough'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'enough') \gexec
