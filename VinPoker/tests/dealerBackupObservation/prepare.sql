-- Disposable test objects only. No actual Vault credentials or network calls.
\set ON_ERROR_STOP on
CREATE SCHEMA net;
CREATE SCHEMA vault;
CREATE TABLE net._http_response(id bigint,status_code integer,timed_out boolean,
 created timestamptz NOT NULL DEFAULT now(),content text);
ALTER TABLE net._http_response ALTER COLUMN content SET STORAGE PLAIN;
CREATE INDEX response_created_idx ON net._http_response(created);
CREATE TABLE net.observation_test_queue(id bigint GENERATED ALWAYS AS IDENTITY(START WITH 1000000),
 url text,body jsonb,params jsonb,headers jsonb,timeout_milliseconds integer);
CREATE TABLE net.observation_test_mode(mode text NOT NULL);
INSERT INTO net.observation_test_mode VALUES('ok');
CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES('PROCESS_SWING_INTERNAL_SECRET','synthetic-fixture-not-a-credential');
CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}'::jsonb,
 params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{}'::jsonb,
 timeout_milliseconds integer DEFAULT 5000) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n bigint;m text;
BEGIN
 SELECT mode INTO STRICT m FROM net.observation_test_mode;
 IF m='error' THEN RAISE EXCEPTION 'synthetic_enqueue_failure'; END IF;
 IF m='null' THEN RETURN NULL; END IF;
 INSERT INTO net.observation_test_queue(url,body,params,headers,timeout_milliseconds)
 VALUES(url,body,params,headers,timeout_milliseconds) RETURNING id INTO n;
 RETURN n;
END$$;
-- Only the test admin can create managed-shaped objects. The migration actor
-- gets read/execute capability, not ownership or CREATE on net/vault.
REVOKE ALL ON SCHEMA net,vault FROM PUBLIC;
GRANT USAGE ON SCHEMA net,vault TO postgres;
GRANT SELECT ON net._http_response,vault.decrypted_secrets TO postgres;
REVOKE ALL ON FUNCTION net.http_post(text,jsonb,jsonb,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION net.http_post(text,jsonb,jsonb,jsonb,integer) TO postgres;
