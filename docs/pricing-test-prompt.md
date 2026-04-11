# Spotless Scrubbers — End-to-End Pricing Test Prompt

Copy this into another AI or use it as a manual test checklist to verify pricing works correctly across every touchpoint.

---

## TEST SCENARIO: 2-Bedroom, 2-Bathroom, ~1200 sqft apartment in Los Angeles

Expected pricing (formula: Standard = $100/bed + $35/bath, Deep/Move = $125/bed + $50/bath):
- Standard Clean: $270 ($100*2 + $35*2)
- Deep Clean: $350 ($125*2 + $50*2)
- Move In/Out: $350 (same as deep)
- Add-on: Inside fridge $25, Inside oven $25, Interior windows $50
- Cleaner pay: 50% of total job price

---

## TEST 1: SMS Conversation (text the Spotless number)

**Send:** "Hey, how much for a cleaning?"

Expected AI response: Should give a range like "$200-470 for standard" and ask about bedrooms/bathrooms.

**Send:** "2 bed 2 bath"

Expected AI response: Should quote "$270 for standard, $350 for deep clean" and ask for address.

**Send:** "123 Test Street, Los Angeles CA 90001"

Expected AI response: Should trigger quote link or booking flow.

**VERIFY:**
- [ ] AI quoted standard price around $270 (formula: $100*2 + $35*2)
- [ ] AI quoted deep clean price around $350 (formula: $125*2 + $50*2)
- [ ] AI mentioned move-in/out option
- [ ] AI did NOT quote old prices ($200 standard or $325 deep — those are old)
- [ ] AI did NOT ask for square footage upfront (should only ask if home sounds unusually large)
- [ ] AI did NOT offer any discounts

---

## TEST 2: VAPI Phone Call (call the Spotless number)

**Say:** "Hi, I need a cleaning for my apartment"

**When asked about size, say:** "It's a 3 bedroom 2 bath"

Expected: Agent should say something like "Standard clean runs about $370, deep clean is around $475."

**VERIFY:**
- [ ] Agent quoted standard ~$370 for 3BR/2BA (formula: $100*3 + $35*2)
- [ ] Agent quoted deep ~$475 for 3BR/2BA (formula: $125*3 + $50*2)
- [ ] Agent did NOT quote old prices ($260 standard or $400 deep)
- [ ] Agent mentioned texting exact pricing with options
- [ ] If you describe cabinets/organizing/OCD detail work, agent should say "that sounds like our Extra Deep service, starts at $500" and offer to transfer

---

## TEST 3: Quote Page (customer view)

After the SMS or VAPI triggers a quote, the customer gets a link. Open it and check:

**VERIFY:**
- [ ] Three tier cards shown: Standard Clean, Deep Clean, Extra Deep Clean
- [ ] Standard Clean price matches formula ($100/bed + $35/bath, min $200)
- [ ] Deep Clean price matches formula ($125/bed + $50/bath, min $250)
- [ ] Each tier lists what's included (standard: 17 items, deep: 21 items)
- [ ] Add-ons shown below tiers with correct prices:
  - Inside fridge: $25
  - Inside oven: $25
  - Inside cabinets: $50
  - Interior windows: $50
  - Exterior windows: $100
  - Pet fee: $25
  - Laundry: $25
  - Garage sweep: $35
- [ ] Selecting an add-on updates the total price correctly
- [ ] Move-in/out option available with higher pricing

---

## TEST 4: Invoice / Stripe Payment

After customer selects a tier and add-ons:

**VERIFY:**
- [ ] Stripe checkout shows correct total (tier price + add-ons)
- [ ] Line items are itemized (service type, add-ons listed separately)
- [ ] No mystery charges or incorrect calculations
- [ ] Deposit amount is correct (if using 50% deposit model)

---

## TEST 5: Cleaner Gets the Job (Telegram + Portal)

After a job is booked and assigned to a cleaner:

**VERIFY Telegram notification:**
- [ ] Cleaner sees: service type, address, date/time
- [ ] Cleaner sees: "Your pay: $[amount]" where amount = 50% of job price
  - Example: 2BR/2BA standard at $200 → cleaner sees "Your pay: $100"
  - Example: 3BR/2BA deep at $400 → cleaner sees "Your pay: $200" (split if 2 cleaners: $100 each)
- [ ] Accept link works

**VERIFY Crew Portal (cleaner logs in):**
- [ ] Job shows correct service type (Standard Clean / Deep Clean / Move In-Out)
- [ ] Checklist is correct for the service type:
  - Standard: 17 items (countertops, stovetop, appliance exteriors, cabinet fronts, toilet, shower, fixtures, towel bars, vacuum, mop, dust, mirrors, light switches, light fixtures, windowsills, baseboards wiped, trash)
  - Deep: 21 items (standard + inside oven, inside fridge, grout scrubbed, interior windows, inside microwave)
  - Move: 26 items (deep + inside cabinets, closets, garage sweep, patio, wall spot cleaning)
- [ ] If add-ons were selected (e.g. inside fridge on a standard clean), those appear as additional checklist items
- [ ] Pay amount shown matches 50% of job price

---

## TEST 6: Sqft Protection (edge cases)

**Test a large home:**
- Text: "I need a cleaning for my loft, it's 1 bed 1 bath but it's about 1800 square feet"
- Expected: AI should quote $200 (formula: $100*1 + $35*1 = $135, min $200). Pricing is by bed/bath only now.

**Test a mansion:**
- Text: "6 bedroom 4 bath, about 4500 square feet"
- Expected: Standard quote $740 ($100*6 + $35*4), deep $890 ($125*6 + $50*4)

**Test extra deep trigger:**
- Text: "I need someone to clean inside all my cabinets, reorganize everything, heavy detail work"
- Expected: AI should say "That sounds like our Extra Deep service, those start at $500" and escalate

---

## TEST 7: Add-on Math

Book a 2BR/2BA standard clean ($270) with these add-ons:
- Inside fridge: +$25
- Inside oven: +$25
- Interior windows: +$50
- Pet fee: +$25

**Expected total: $395**
**Cleaner pay: $197.50 (50% of $395)**
**Cleaner checklist: 17 standard items + 3 add-on items (fridge, oven, windows)**

**VERIFY:**
- [ ] Total on quote page = $395
- [ ] Stripe charge = $395 (or deposit portion)
- [ ] Cleaner pay shows $197.50
- [ ] Checklist has 20 items (17 + 3 add-ons)

---

## TEST 8: Cedar Rapids (same pricing)

Repeat Tests 1-3 using the Cedar Rapids phone/SMS number.

**VERIFY:**
- [ ] Same pricing as Spotless for identical bed/bath combos
- [ ] Cleaner pay at 50%
- [ ] Same checklists

---

## PRICING REFERENCE TABLE (what everything should show)

### Pricing Formula
- **Standard Clean:** $100 per bedroom + $35 per bathroom (minimum $200)
- **Deep Clean / Move In-Out:** $125 per bedroom + $50 per bathroom (minimum $250)

### Standard Clean
| Size | Price | Formula |
|------|-------|---------|
| 1BR/1BA | $200 | min($135, $200) |
| 2BR/1BA | $235 | $200 + $35 |
| 2BR/2BA | $270 | $200 + $70 |
| 3BR/2BA | $370 | $300 + $70 |
| 4BR/2BA | $470 | $400 + $70 |
| 4BR/3BA | $505 | $400 + $105 |

### Deep Clean / Move In-Out
| Size | Price | Formula |
|------|-------|---------|
| 1BR/1BA | $250 | min($175, $250) |
| 2BR/1BA | $300 | $250 + $50 |
| 2BR/2BA | $350 | $250 + $100 |
| 3BR/2BA | $475 | $375 + $100 |
| 4BR/2BA | $600 | $500 + $100 |
| 4BR/3BA | $650 | $500 + $150 |

### Extra Deep (Custom Quote)
- Minimum: $500
- AI escalates to human for quote
- Includes: inside all cabinets, reorganizing, heavy detail work

### Cleaner Pay: 50% of total (tier + add-ons)
