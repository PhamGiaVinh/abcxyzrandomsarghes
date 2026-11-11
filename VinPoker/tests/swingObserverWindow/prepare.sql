-- Disposable fixture; managed-shaped response table belongs to test admin.
CREATE SCHEMA net;
CREATE TABLE net._http_response(id bigint,status_code integer,timed_out boolean,created timestamptz NOT NULL,content text);
ALTER TABLE net._http_response ALTER COLUMN content SET STORAGE PLAIN;
CREATE INDEX response_created_idx ON net._http_response(created);
REVOKE ALL ON SCHEMA net FROM PUBLIC;
GRANT USAGE ON SCHEMA net TO postgres;
GRANT SELECT ON net._http_response TO postgres;
