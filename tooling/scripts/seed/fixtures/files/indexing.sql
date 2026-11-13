-- Query-plan workshop: indexes are access paths with a write cost.
CREATE TABLE readings (id INTEGER PRIMARY KEY, station TEXT NOT NULL, observed_at INTEGER NOT NULL, value REAL NOT NULL);
CREATE INDEX readings_station_time ON readings(station, observed_at);

-- The leading station filter and time range can use the composite index.
EXPLAIN QUERY PLAN
SELECT observed_at, value FROM readings
WHERE station = 'north-field' AND observed_at >= 1761955200
ORDER BY observed_at;

-- Compare this plan with an aggregate over every station. A full scan may be suitable.
SELECT station, AVG(value) AS average_value FROM readings GROUP BY station;
