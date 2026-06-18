BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS save_payment_info BOOLEAN NOT NULL DEFAULT false;

COMMIT;
