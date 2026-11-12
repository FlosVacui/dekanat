#!/bin/sh
# Выполняется один раз при первом создании тома базы (docker-entrypoint-initdb.d).
# Создаёт роль приложения без прав суперпользователя. НЕ ЗАПУСКАЛОСЬ: Docker на ноутбуке разработки нет (пакет 2.5).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_password="$APP_ROLE_PASSWORD" <<'SQL'
CREATE ROLE dekanat_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
REVOKE ALL ON DATABASE dekanat FROM PUBLIC;
GRANT CONNECT ON DATABASE dekanat TO dekanat_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dekanat_app;
SQL
