-- SSA Recipient Explorer: PostgreSQL schema (system of record).
-- ALL DATA IS SYNTHETIC. No real SSNs or personal data: only a masked last-four and a synthetic id.
--
-- Coded columns use the C++ engine's indices; the lookup tables below mirror engine/src/engine.cpp
-- exactly (generated from it). Constraints and indexes live in 02_constraints_indexes.sql so a bulk
-- COPY can load first and build indexes once.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS states (
  id    smallint PRIMARY KEY,
  code  char(2)  NOT NULL UNIQUE,
  name  text     NOT NULL
);

CREATE TABLE IF NOT EXISTS benefit_types (
  id    smallint PRIMARY KEY,
  name  text     NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS statuses (
  id    smallint PRIMARY KEY,
  name  text     NOT NULL UNIQUE
);

INSERT INTO states (id, code, name) VALUES
  (0, 'AL', 'Alabama'),
  (1, 'AK', 'Alaska'),
  (2, 'AZ', 'Arizona'),
  (3, 'AR', 'Arkansas'),
  (4, 'CA', 'California'),
  (5, 'CO', 'Colorado'),
  (6, 'CT', 'Connecticut'),
  (7, 'DE', 'Delaware'),
  (8, 'DC', 'District of Columbia'),
  (9, 'FL', 'Florida'),
  (10, 'GA', 'Georgia'),
  (11, 'HI', 'Hawaii'),
  (12, 'ID', 'Idaho'),
  (13, 'IL', 'Illinois'),
  (14, 'IN', 'Indiana'),
  (15, 'IA', 'Iowa'),
  (16, 'KS', 'Kansas'),
  (17, 'KY', 'Kentucky'),
  (18, 'LA', 'Louisiana'),
  (19, 'ME', 'Maine'),
  (20, 'MD', 'Maryland'),
  (21, 'MA', 'Massachusetts'),
  (22, 'MI', 'Michigan'),
  (23, 'MN', 'Minnesota'),
  (24, 'MS', 'Mississippi'),
  (25, 'MO', 'Missouri'),
  (26, 'MT', 'Montana'),
  (27, 'NE', 'Nebraska'),
  (28, 'NV', 'Nevada'),
  (29, 'NH', 'New Hampshire'),
  (30, 'NJ', 'New Jersey'),
  (31, 'NM', 'New Mexico'),
  (32, 'NY', 'New York'),
  (33, 'NC', 'North Carolina'),
  (34, 'ND', 'North Dakota'),
  (35, 'OH', 'Ohio'),
  (36, 'OK', 'Oklahoma'),
  (37, 'OR', 'Oregon'),
  (38, 'PA', 'Pennsylvania'),
  (39, 'PR', 'Puerto Rico'),
  (40, 'RI', 'Rhode Island'),
  (41, 'SC', 'South Carolina'),
  (42, 'SD', 'South Dakota'),
  (43, 'TN', 'Tennessee'),
  (44, 'TX', 'Texas'),
  (45, 'UT', 'Utah'),
  (46, 'VT', 'Vermont'),
  (47, 'VA', 'Virginia'),
  (48, 'WA', 'Washington'),
  (49, 'WV', 'West Virginia'),
  (50, 'WI', 'Wisconsin'),
  (51, 'WY', 'Wyoming')
ON CONFLICT (id) DO NOTHING;

INSERT INTO benefit_types (id, name) VALUES
  (0, 'Retirement'),
  (1, 'Disability'),
  (2, 'Survivor'),
  (3, 'SSI'),
  (4, 'Spouse'),
  (5, 'Child')
ON CONFLICT (id) DO NOTHING;

INSERT INTO statuses (id, name) VALUES
  (0, 'Active'),
  (1, 'Pending'),
  (2, 'Suspended'),
  (3, 'Terminated')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS recipients (
  id                integer  NOT NULL,
  first_name        text     NOT NULL,
  last_name         text     NOT NULL,
  ssn_last4         smallint NOT NULL CHECK (ssn_last4 BETWEEN 0 AND 9999),
  birth_year        smallint NOT NULL,
  zip3              smallint NOT NULL CHECK (zip3 BETWEEN 0 AND 999),
  state_id          smallint NOT NULL,
  benefit_type_id   smallint NOT NULL,
  status_id         smallint NOT NULL,
  monthly_cents     integer  NOT NULL CHECK (monthly_cents >= 0),
  entitlement_year  smallint NOT NULL
);

COMMENT ON TABLE recipients IS 'SYNTHETIC benefit-recipient records for the SSA Recipient Explorer research demo. Not real people.';
COMMENT ON COLUMN recipients.ssn_last4 IS 'Synthetic masked last four digits only; no full SSN is ever stored.';
