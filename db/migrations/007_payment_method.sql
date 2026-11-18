-- How each payment was made. Card payments start a Paystack subscription that renews
-- itself; Mobile Money can't be charged automatically, so each one pays for one month.
ALTER TABLE payments  ADD COLUMN method text NOT NULL DEFAULT 'card' CHECK (method IN ('card', 'momo'));
ALTER TABLE purchases ADD COLUMN method text NOT NULL DEFAULT 'card' CHECK (method IN ('card', 'momo'));
