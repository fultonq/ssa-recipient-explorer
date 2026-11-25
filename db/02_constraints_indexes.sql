-- Applied after the bulk load. Indexes cover every filter and sort key the API offers, so the
-- PostgreSQL baseline in the benchmark is a fairly tuned one, not a strawman.

ALTER TABLE recipients ADD CONSTRAINT recipients_pkey PRIMARY KEY (id);
ALTER TABLE recipients ADD CONSTRAINT recipients_state_fk  FOREIGN KEY (state_id)        REFERENCES states(id);
ALTER TABLE recipients ADD CONSTRAINT recipients_type_fk   FOREIGN KEY (benefit_type_id) REFERENCES benefit_types(id);
ALTER TABLE recipients ADD CONSTRAINT recipients_status_fk FOREIGN KEY (status_id)       REFERENCES statuses(id);

-- Filters
CREATE INDEX recipients_state_idx        ON recipients (state_id);
CREATE INDEX recipients_type_status_idx  ON recipients (benefit_type_id, status_id);
CREATE INDEX recipients_cents_idx        ON recipients (monthly_cents, id);
CREATE INDEX recipients_birth_idx        ON recipients (birth_year, id);
CREATE INDEX recipients_ent_idx          ON recipients (entitlement_year, id);
CREATE INDEX recipients_last4_idx        ON recipients (ssn_last4);

-- Name search: case-insensitive substring match via trigram GIN indexes
CREATE INDEX recipients_first_trgm_idx   ON recipients USING gin (lower(first_name) gin_trgm_ops);
CREATE INDEX recipients_last_trgm_idx    ON recipients USING gin (lower(last_name) gin_trgm_ops);

-- Sorts (byte-order collation matches the engine's std::string ordering; id is the tie-break)
CREATE INDEX recipients_lastname_sort_idx  ON recipients (last_name COLLATE "C", first_name COLLATE "C", id);
CREATE INDEX recipients_firstname_sort_idx ON recipients (first_name COLLATE "C", last_name COLLATE "C", id);
CREATE INDEX recipients_state_sort_idx     ON recipients (state_id, id);

ANALYZE recipients;
