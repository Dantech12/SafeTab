// Test-only configuration. Sample values; the Paystack key is a dummy used to sign fake webhooks.
process.env.NODE_ENV = "test";
process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgres://safetab_app:safetab_app_dev_only@localhost:5432/safetab_test";
process.env.DATABASE_OWNER_URL ??= "postgres://safetab:safetab_dev_only@localhost:5432/safetab_test";
process.env.TOKEN_PEPPER = "test-pepper-test-pepper-test-pepper-0123456789";
process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy_for_unit_tests";
process.env.PAYSTACK_PLAN_INDIVIDUAL = "PLN_test_individual";
process.env.PAYSTACK_PLAN_ORGANIZATION = "PLN_test_organization";
process.env.BILLING_CURRENCY = "USD";
process.env.MDM_PROVIDER = "fake";
process.env.COMPANION_APP_ENABLED = "true";
