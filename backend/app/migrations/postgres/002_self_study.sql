UPDATE documents
SET body = jsonb_set(body::jsonb, '{source}', '"legacy_seed"')::text
WHERE collection = 'assignments' AND id IN ('vo-nhat', 'chi-pheo', 'song');

UPDATE documents
SET body = jsonb_set(body::jsonb, '{source}', '"student"')::text
WHERE collection = 'assignments' AND NOT (body::jsonb ? 'source');
