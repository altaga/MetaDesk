-- Traceable ops: correlate Millie + chat tools under one request_id.
ALTER TABLE ops_events ADD COLUMN trace_id TEXT;
ALTER TABLE ops_events ADD COLUMN phase TEXT;
CREATE INDEX ops_events_trace ON ops_events (trace_id, id);
CREATE INDEX ops_events_device_created ON ops_events (device_id, created_at DESC);
