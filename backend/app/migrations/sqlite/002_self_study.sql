UPDATE documents
SET body = json_set(body, '$.source', 'legacy_seed')
WHERE collection = 'assignments' AND id IN ('vo-nhat', 'chi-pheo', 'song');

UPDATE documents
SET body = json_set(body, '$.source', 'student')
WHERE collection = 'assignments' AND json_extract(body, '$.source') IS NULL;
