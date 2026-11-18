-- The paid-until date a "your plan ends soon" email was last sent for, so each period
-- gets one reminder. Paying again moves current_period_end, which re-arms it.
ALTER TABLE subscriptions ADD COLUMN renewal_reminder_for timestamptz;
