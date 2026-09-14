-- Separate database for integration tests so they never truncate development data.
-- Runs only when the data volume is initialised for the first time.
CREATE DATABASE relayforge_test;
