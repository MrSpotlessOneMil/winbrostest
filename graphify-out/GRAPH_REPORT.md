# Graph Report - .  (2026-04-10)

## Corpus Check
- Large corpus: 1690 files · ~3,673,296 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 2028 nodes · 3369 edges · 94 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `POST()` - 52 edges
2. `getSupabaseClient()` - 51 edges
3. `GET()` - 38 edges
4. `MockQueryBuilder` - 32 edges
5. `processTask()` - 16 edges
6. `MockSupabaseClient` - 16 edges
7. `getVapiAvailabilityResponse()` - 14 edges
8. `hcpRequest()` - 14 edges
9. `apiFetch()` - 13 edges
10. `getSupabase()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Spotless Scrubbers` --conceptually_related_to--> `Osiris Platform`  [INFERRED]
  apps/house-cleaning/public/llms.txt → CLAUDE.md
- `WinBros Window Cleaning` --conceptually_related_to--> `Osiris Platform`  [INFERRED]
  Documentation/LIVE-TENANTS.md → CLAUDE.md
- `handleMembershipAction()` --calls--> `fetchMemberships()`  [EXTRACTED]
  apps\window-washing\app\(dashboard)\customers\page.tsx → apps\window-washing\app\(dashboard)\memberships\page.tsx
- `handleCreateMembership()` --calls--> `fetchMemberships()`  [EXTRACTED]
  apps\window-washing\app\(dashboard)\customers\page.tsx → apps\window-washing\app\(dashboard)\memberships\page.tsx
- `POST()` --calls--> `toCsvRow()`  [EXTRACTED]
  apps\window-washing\app\api\webhooks\website\[slug]\route.ts → apps\window-washing\app\api\actions\export\route.ts

## Hyperedges (group relationships)
- **Telegram to SMS Migration** — telegram_removal, cleaner_portal, openphone_sms [EXTRACTED 0.95]
- **Lead Intake to Payment Pipeline** — dynamic_lead_automation, vapi_voice_ai, openphone_sms, hcp_integration, stripe_payments, lead_followup_sequence [EXTRACTED 0.90]
- **Data Integrity Infrastructure** — rls_security, cron_locking_pattern, cross_tenant_isolation, supabase_db [INFERRED 0.85]
- **RLS Enforcement Cascade** — rls_enforcement_verified, rls_cron_bugs_verified, rls_service_client_fix, rls_cleanup_verified [EXTRACTED 1.00]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (130): addDays(), api(), cancelRetargeting(), confirmDelete(), createCleaner(), createTeam(), CrewAssignmentPage(), deleteBusiness() (+122 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (22): mapEvent(), timeAgo(), truncate(), CarouselNext(), useCarousel(), handleSave(), resetForm(), formatDate() (+14 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (137): addDays(), addMonths(), buildOwnerCancelAlert(), buildSystemPrompt(), buildTools(), calculateNextDate(), checkPersonalHours(), computeDateRange() (+129 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (70): analyzeConversationPatterns(), findSimilarWinningConversations(), generateEmbedding(), scoreConversation(), embedPendingChunks(), generateEmbeddingsBatch(), fallbackAnswer(), logDecision() (+62 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (41): buildMemoryContext(), getActiveMemoryFacts(), getRelevantEpisodes(), getUsageStats(), assignNextAvailableCleaner(), calculateDistance(), cascadeToNextCleaner(), findBestCleaners() (+33 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (46): buildSystemPrompt(), buildUserPrompt(), extractCleanerUpdatesWithLLM(), hasUpdates(), isValidTime(), normalizeAvailability(), normalizeDecision(), normalizeIntent() (+38 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (9): makeBookedJob(), makeCompletedJob(), createCronPostRequest(), createCronRequest(), createMockRequest(), resetAllMocks(), resetMockClient(), makeVapiEndOfCallReport() (+1 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (46): buildCustomerFirstNameOnly(), buildCustomerName(), buildFallbackNotes(), buildInvoiceNoteContext(), buildInvoiceNotes(), buildInvoiceSummaryLines(), buildPropertyLine(), buildStaticCleaningDescription() (+38 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (34): calculateSilenceDuration(), formatServiceList(), getClientServices(), getCustomerStatus(), getCustomerStatusLabel(), shouldTriggerCall(), getCrewPerformance(), getMonthEnd() (+26 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (39): detectBrandFromGHL(), detectBrandFromOpenPhone(), detectBrandFromVAPI(), getAllConfiguredBrands(), getBrandMappings(), getClientConfig(), parseList(), createConnecteamShift() (+31 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (10): calculatePrice(), QuoteCalculator(), roundToNearest5(), fbq(), gtag(), trackFormSubmit(), trackLead(), trackPageView() (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (32): analyzeBookingIntent(), analyzeWithClaude(), analyzeWithKeywords(), analyzeWithOpenAI(), detectFakeScheduling(), detectSilentHandoff(), formatCustomerContextForPrompt(), formatDateForContext() (+24 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (2): MockQueryBuilder, MockSupabaseClient

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (27): computeTierPrice(), getWindowTier(), lookupGutterPrice(), lookupPressureWashingPrice(), lookupPrice(), normalizeText(), detectAddOnsFromText(), getAddOnDefinition() (+19 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (31): buildAddressCreatePayload(), buildAuthHeaderCandidates(), buildCustomerCreateAddresses(), buildHcpRequestAttempts(), buildScheduleWindow(), completeHCPJob(), convertHCPLeadToJob(), createHCPCustomerAlways() (+23 more)

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (30): brain_chunks Table (pgvector), brain_decisions Table, brain_sources Table, analyzeSentiment(), analyzeText(), extractEntities(), getApiKey(), isNlpAvailable() (+22 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (27): checkAndHandleRainDay(), formatDateHuman(), getAffectedJobs(), getCandidateDates(), getJobCountsByDate(), getNextWorkday(), rescheduleAllJobs(), rescheduleJob() (+19 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (27): apiFetch(), buildUrl(), cancelJob(), completeJob(), createCustomer(), createJob(), getCustomer(), getEmployee() (+19 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (28): buildInvoiceDescription(), calculateJobEstimate(), calculateJobEstimateAsync(), calculateJobPrice(), calculateJobPriceAsync(), chargeCardOnFile(), createAddOnPaymentLink(), createAndSendInvoice() (+20 more)

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (7): cloneVapiForTenant(), createAssistant(), customizeAssistantConfig(), loadTemplate(), replaceInPrompt(), stripReadOnlyFields(), updateToolUrls()

### Community 20 - "Community 20"
Cohesion: 0.1
Nodes (27): Cleaner Portal, Context-Aware SMS Bot, Cross-Tenant Isolation Hardening, Dynamic Lead Automation System, HousecallPro Integration, 5-Stage Lead Follow-up Sequence, Osiris Master Plan, OpenPhone SMS System (+19 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (25): addMinutes(), anyTeamAvailable(), createPacificDate(), fetchJobs(), fetchTeams(), findAvailableSlots(), firstString(), getDayOfWeekFromDate() (+17 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (16): buildFallbackMessage(), buildSystemPrompt(), buildUserPrompt(), ensureFooter(), generateClaudeResponse(), generateOpenAIResponse(), generateResponse(), decodeIfBase64ToBuffer() (+8 more)

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (20): formatDate(), formatTime(), getBaseUrl(), humanize(), jobUrl(), notifyCleanerAssignment(), notifyCleanerAwarded(), notifyCleanerNotSelected() (+12 more)

### Community 24 - "Community 24"
Cohesion: 0.17
Nodes (21): batchGeocodeAddresses(), geocodeAddress(), geocodeWithNominatim(), getApiKey(), getDistanceMatrix(), getPairwiseDistanceMatrix(), haversineKm(), haversineMinutes() (+13 more)

### Community 25 - "Community 25"
Cohesion: 0.18
Nodes (20): buildRawEmail(), createTransporter(), formatPhoneForDisplay(), getGmailApiClient(), getGmailCreds(), hasServiceAccountCreds(), sendConfirmationEmail(), sendCustomEmail() (+12 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (14): createEmployeeSession(), createSession(), detectIdentifierType(), generateToken(), getAuthCleaner(), getAuthTenant(), getAuthUser(), getSession() (+6 more)

### Community 27 - "Community 27"
Cohesion: 0.2
Nodes (17): addJobNotes(), assignEmployeeToJob(), createCustomer(), createEstimate(), createJob(), findCustomerByPhone(), getCustomer(), getCustomers() (+9 more)

### Community 28 - "Community 28"
Cohesion: 0.11
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 0.26
Nodes (16): createLocalDate(), findAlternatives(), formatDateDisplay(), formatTimeDisplay(), formatTimeFromMinutes(), getDayOfWeekFromDate(), getLocalNow(), getNextCandidateDates() (+8 more)

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (9): main(), test(), testCronAuth(), testDisabledCrons(), testQuotePage(), testVapiSendText(), testVapiWebhook(), testWebhookAuth() (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.24
Nodes (6): getLiveDashboardData(), getLiveSettings(), getPool(), getSupabaseDashboardData(), resolveCustomerName(), saveLiveSettings()

### Community 32 - "Community 32"
Cohesion: 0.36
Nodes (11): escapeHtml(), formatDate(), getPostSlug(), init(), injectArticleJsonLd(), injectJsonLd(), loadPosts(), loadSinglePost() (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.29
Nodes (8): chunkTranscript(), classifyChunkDomains(), fetchTranscript(), fetchVideoDetails(), listChannelVideos(), parseDuration(), processQueuedSources(), queueChannel()

### Community 34 - "Community 34"
Cohesion: 0.2
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 0.27
Nodes (4): computeLeaderboard(), loadVariants(), main(), printLeaderboard()

### Community 36 - "Community 36"
Cohesion: 0.25
Nodes (2): formatTimeRemaining(), updateTimer()

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (2): fmtTime(), ScheduleGantt()

### Community 38 - "Community 38"
Cohesion: 0.36
Nodes (5): addToRemoveQueue(), dispatch(), genId(), reducer(), toast()

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 0.39
Nodes (5): calculateCascade(), generateCascadeSummary(), getDurationHours(), parseJobDate(), toDateKey()

### Community 41 - "Community 41"
Cohesion: 0.46
Nodes (7): createForm(), handleSubmit(), hideError(), init(), showError(), showSuccess(), validate()

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (8): Cross-Tenant Action Route Vulnerability, getSupabaseServiceClient() - Service Role Client, getTenantScopedClient() - Anon Key + Custom JWT, RLS Cleanup Post-Enforcement Verification, RLS Cron Bugs Fix and Verification, RLS Tenant Isolation Enforcement Verification, RLS Service Client Fix for Payment Routes, tenant_isolation RLS Policy (16 Tables)

### Community 43 - "Community 43"
Cohesion: 0.48
Nodes (5): assignCleaner(), cleanup(), createJob(), createLead(), db()

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (2): getIntegrationStatus(), isIntegrationConfigured()

### Community 45 - "Community 45"
Cohesion: 0.53
Nodes (4): answerControlCallbackQuery(), editControlMessageReplyMarkup(), getControlBotToken(), sendControlTelegramMessage()

### Community 46 - "Community 46"
Cohesion: 0.8
Nodes (5): hcpFetch(), log(), logResult(), main(), printSummary()

### Community 47 - "Community 47"
Cohesion: 0.73
Nodes (5): deployVariant(), fixTools(), main(), upgradeSettings(), vapiRequest()

### Community 48 - "Community 48"
Cohesion: 0.83
Nodes (3): isExternalRoute(), isPublicRoute(), middleware()

### Community 49 - "Community 49"
Cohesion: 0.83
Nodes (3): cleanupTestJobs(), createJobWithAssignment(), supabase()

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (2): getAdminOwner(), getSupabase()

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (2): main(), updateAssistant()

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 2.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (0): 

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (0): 

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (0): 

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (0): 

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (0): 

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (0): 

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (0): 

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (0): 

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (0): 

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (0): 

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (0): 

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (1): Membership Feature

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (1): Multi-Tenant Setup Guide

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (1): Lifecycle Messaging System

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (1): Cron Locking Pattern

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (1): Scheduled Tasks Queue

### Community 92 - "Community 92"
Cohesion: 1.0
Nodes (1): Pricing Formula (bed/bath based)

### Community 93 - "Community 93"
Cohesion: 1.0
Nodes (1): llms.txt - Spotless Scrubbers Public Info

## Knowledge Gaps
- **22 isolated node(s):** `Telegram Removal / SMS Migration`, `Membership Feature`, `Multi-Tenant Setup Guide`, `Spotless Scrubbers`, `WinBros Window Cleaning` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 53`** (2 nodes): `error.tsx`, `DashboardError()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (2 nodes): `robots.ts`, `robots()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (2 nodes): `fluid-background.tsx`, `FluidBackground()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (2 nodes): `velocity-fluid-background.tsx`, `VelocityFluidBackground()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (2 nodes): `sonner.tsx`, `Toaster()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (2 nodes): `recurring-detection.ts`, `detectRecurringIntent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `audit.ts`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (2 nodes): `backfill-hcp-jobs.ts`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (2 nodes): `backfill-stale-leads.ts`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (2 nodes): `addon-autoselect.spec.ts`, `openCreateForm()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (2 nodes): `mobile-responsive.spec.ts`, `checkNoHorizontalOverflow()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `playwright.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `playwright.crash.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `playwright.mobile.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `global-error.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `aspect-ratio.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `sw.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `action-auth.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `admin-security.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `auth.setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `crew-portal-calendar.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `crew-portal.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `cron-security.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `csv-injection.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `dashboard.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `leads.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `memberships.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `quote-tiers-qa.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `session-fixes.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `tenant-isolation-api.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `unidentified-numbers.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (1 nodes): `webhook-security.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (1 nodes): `Membership Feature`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (1 nodes): `Multi-Tenant Setup Guide`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (1 nodes): `Lifecycle Messaging System`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (1 nodes): `Cron Locking Pattern`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (1 nodes): `Scheduled Tasks Queue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (1 nodes): `Pricing Formula (bed/bath based)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (1 nodes): `llms.txt - Spotless Scrubbers Public Info`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MockQueryBuilder` connect `Community 12` to `Community 6`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `MockSupabaseClient` connect `Community 12` to `Community 6`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `Osiris Platform` connect `Community 20` to `Community 6`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `Telegram Removal / SMS Migration`, `Membership Feature`, `Multi-Tenant Setup Guide` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._