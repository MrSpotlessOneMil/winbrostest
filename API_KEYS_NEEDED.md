# API Keys and Environment Variables Needed

This document lists all the API keys and environment variables you need to provide in your `.env.local` file.

## Required (Core Functionality)

### 1. Supabase (Database)
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```
**How to get:** Supabase Dashboard → Settings → API → Copy URL and service_role key

### 2. OpenPhone (SMS)
```
OPENPHONE_API_KEY=your-api-key
OPENPHONE_PHONE_NUMBER_ID=your-phone-number-id
OPENPHONE_WEBHOOK_SECRET=your-webhook-secret
```
**How to get:** OpenPhone Dashboard → API → Generate API Key, Phone Numbers → Copy ID, Webhooks → Copy secret

### 3. VAPI (Voice AI Calls)
```
VAPI_API_KEY=your-api-key
VAPI_ASSISTANT_ID=your-assistant-id
VAPI_OUTBOUND_PHONE_ID=your-phone-id
```
**How to get:** VAPI Dashboard → API Keys, Assistants → Copy ID, Phone Numbers → Copy ID

### 4. Stripe (Payments)
```
STRIPE_SECRET_KEY=sk_live_... or sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
**How to get:** Stripe Dashboard → Developers → API keys, Webhooks → Add endpoint → Copy signing secret

### 5. Telegram (Cleaner Notifications)
```
TELEGRAM_BOT_TOKEN=your-bot-token
```
**How to get:** Message @BotFather on Telegram → /newbot → Follow instructions

### 6. AI/LLM (At least one required)
```
OPENAI_API_KEY=sk-...
# OR
ANTHROPIC_API_KEY=sk-ant-...
```
**How to get:** 
- OpenAI: platform.openai.com → API keys
- Anthropic: console.anthropic.com → API keys

## Highly Recommended

### 7. Wave (Invoicing)
```
WAVE_API_TOKEN=your-token
WAVE_BUSINESS_ID=your-business-id
WAVE_INCOME_ACCOUNT_ID=your-account-id
```
**How to get:** Wave Dashboard → Settings → API → Generate token, Business ID from URL, Accounts → Income account ID

### 8. QStash (Scheduled Tasks)
```
QSTASH_TOKEN=your-token
QSTASH_CURRENT_SIGNING_KEY=your-signing-key
QSTASH_NEXT_SIGNING_KEY=your-next-key (optional, for key rotation)
```
**How to get:** Upstash Dashboard → QStash → Create queue → Copy token and signing keys

## Optional (Feature-Specific)

### 9. GoHighLevel (GHL) - For Meta Ads leads
```
ENABLE_GHL=true
GHL_API_KEY=your-api-key
GHL_LOCATION_ID=your-location-id
BRAND_GHL_SPOTLESS=location-id-1 (if multi-brand)
BRAND_GHL_FIGUEROA=location-id-2
BRAND_GHL_WINBROS=location-id-3
```

### 10. HubSpot - For CRM sync
```
ENABLE_HUBSPOT=true
HUBSPOT_ACCESS_TOKEN=your-access-token
HUBSPOT_STAGE_LEAD=lead-stage-id
HUBSPOT_STAGE_QUOTED=quoted-stage-id
HUBSPOT_STAGE_SCHEDULED=scheduled-stage-id
HUBSPOT_STAGE_COMPLETED=completed-stage-id
HUBSPOT_STAGE_CANCELLED=cancelled-stage-id
HUBSPOT_STAGE_DEFAULT=default-stage-id
```

### 11. DocuSign - For contracts
```
ENABLE_DOCUSIGN=true
DOCUSIGN_ACCESS_TOKEN=your-token
DOCUSIGN_ACCOUNT_ID=your-account-id
DOCUSIGN_TEMPLATE_ID=your-template-id
```

### 12. Connecteam - For shift management
```
ENABLE_CONNECTEAM=true
CONNECTEAM_API_KEY=your-key
CONNECTEAM_COMPANY_ID=your-company-id
```

### 13. Housecall Pro - For WinBros
```
ENABLE_HOUSECALL_PRO=true
HOUSECALL_PRO_API_KEY=your-key
HOUSECALL_PRO_COMPANY_ID=your-company-id
HOUSECALL_PRO_WEBHOOK_SECRET=your-secret
```

### 14. Weather API - For weather briefings
```
ENABLE_WEATHER_BRIEFINGS=true
OPENWEATHER_API_KEY=your-key
```

## Business Configuration

```
BRAND_MODE=spotless  # or figueroa, winbros
BUSINESS_NAME=Your Business Name
BUSINESS_NAME_SHORT=Short Name
SDR_PERSONA=Mary
SERVICE_AREA=Los Angeles
CLEANER_HOURLY_RATE=25
DEPOSIT_PERCENT=50
PROCESSING_FEE_PCT=3
NEXT_PUBLIC_DOMAIN=https://your-domain.com
OWNER_PHONE=+15551234567
ADMIN_EMAIL=admin@yourbusiness.com
```

## Security

```
CRON_SECRET=random-secret-string-for-cron-auth
```

## Complete .env.local Template

See `.env.example` file for the complete template with all variables and descriptions.

## Testing Locally

1. Copy `.env.example` to `.env.local`
2. Fill in all REQUIRED variables
3. Run `npm install`
4. Run `npm run dev`
5. Test webhook endpoints using tools like ngrok for local development
