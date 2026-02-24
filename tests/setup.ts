/**
 * Global test setup — sets dummy env vars so modules don't crash on import.
 * Every external API call is mocked, so these values are never sent anywhere.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-xxxx'
process.env.CRON_SECRET = 'test-cron-secret'
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.NEXT_PUBLIC_APP_URL = 'https://test-app.vercel.app'
process.env.GMAIL_USER = 'test@gmail.com'
process.env.GMAIL_APP_PASSWORD = 'test-gmail-password'
process.env.QSTASH_TOKEN = 'test-qstash-token'
process.env.QSTASH_URL = 'https://qstash.test'
process.env.QSTASH_CURRENT_SIGNING_KEY = 'test-signing-key'
process.env.QSTASH_NEXT_SIGNING_KEY = 'test-next-signing-key'
process.env.NODE_ENV = 'test'
