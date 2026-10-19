-- Fencing token for the chain worker's lease (SEC-04).
--
-- The advisory lock makes one worker the leader. A worker that loses the lock
-- without noticing (a dropped connection, a long pause) can still be running
-- while the next one takes over. Each lease takes the next token here, and the
-- nonce sequencer refuses to broadcast for a worker whose token is no longer the
-- current one. Written by hand like every migration since 0009.
CREATE TABLE "worker_fencing" (
  "name" text PRIMARY KEY NOT NULL,
  "token" numeric(78, 0) NOT NULL
);
