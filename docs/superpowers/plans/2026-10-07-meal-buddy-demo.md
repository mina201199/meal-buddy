# Meal Buddy Mobile Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-runnable, mobile-first HTML demo that connects restaurant discovery with one-to-one invitations and public group meals.

**Architecture:** Create a self-contained `meal-buddy-demo/` frontend beside the existing app without changing `index.html` or `index-jev.html`. Keep seed data, pure state transitions, rendering, and styling separated so the demo can later replace mocked AI and restaurant data with backend APIs.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript, Node.js built-in `node:test`, browser History-free single-page navigation.

**Spec:** `docs/superpowers/specs/2026-10-07-meal-buddy-design.md`

## Global Constraints

- The experience is a pure friendship meal-buddy platform, not dating.
- Only users aged 18 or older are represented.
- Support both one-to-one invitations and public groups of 2–6 people.
- Show profile photos, but never rank by appearance, gender, or sensitive attributes.
- Do not expose live user coordinates, home addresses, phone numbers, or external social accounts.
- OpenAI is not called in this demo; AI parsing must be clearly labeled as simulated.
- Existing `index.html` and `index-jev.html` must remain unchanged.
- The primary layout targets a 390px mobile canvas and remains fully operable in desktop browsers and at widths from 320px to 430px without horizontal overflow.
- All people, ratings, restaurants, messages, and AI outputs in the demo are fictional and visibly labeled as demo data.
- The workspace has no Git repository. Run every verification step, but omit commit commands because no commit can be created.

---

## File Structure

- `meal-buddy-demo/index.html` — semantic app shell, view containers, dialogs, and bottom navigation.
- `meal-buddy-demo/styles.css` — mobile-first visual system, responsive desktop frame, cards, sheets, and accessibility states.
- `meal-buddy-demo/data.js` — fictional restaurants, profiles, meal intents, public groups, and chat seed data.
- `meal-buddy-demo/logic.js` — pure parsing, sorting, grouping, invitation, and group-capacity functions usable by browser and Node tests.
- `meal-buddy-demo/app.js` — UI state, event delegation, rendering, simulated microphone flow, navigation, and persistence for the current tab.
- `meal-buddy-demo/tests/logic.test.js` — Node tests for filtering, ordering, invitation rules, expiration, and capacity.
- `.claude/launch.json` — add a non-conflicting preview entry only if the existing preview configuration cannot serve the new folder.

### Task 1: Seed Data and Pure Recommendation Logic

**Files:**
- Create: `meal-buddy-demo/data.js`
- Create: `meal-buddy-demo/logic.js`
- Create: `meal-buddy-demo/tests/logic.test.js`

**Interfaces:**
- Consumes: no earlier task.
- Produces: `parseDemoRequest(text)`, `rankRestaurants(restaurants, criteria)`, `groupIntentsByWindow(intents, now)`, `canInvite(senderId, recipientId, intent, invitations, now)`, `canJoinGroup(group)`, and `createInvitation(input, now)`.

- [ ] **Step 1: Write failing parsing and ranking tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../logic.js');

test('parses tomorrow lunch, salty food, and NT$100', () => {
  assert.deepEqual(logic.parseDemoRequest('明天午餐想吃鹹的，預算100'), {
    day: 'tomorrow', meal: 'lunch', taste: ['salty'], budget: 100,
  });
});

test('ranks an open nearby high-rated restaurant above a distant one', () => {
  const criteria = { budget: 150, taste: ['salty'], maxDistance: 1500 };
  const ranked = logic.rankRestaurants([
    { id: 'far', distance: 1300, rating: 4.8, price: 120, tastes: ['salty'], open: true },
    { id: 'near', distance: 250, rating: 4.6, price: 110, tastes: ['salty'], open: true },
  ], criteria);
  assert.equal(ranked[0].id, 'near');
  assert.ok(ranked[0].matchScore > ranked[1].matchScore);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test meal-buddy-demo/tests/logic.test.js`

Expected: FAIL because `logic.js` does not exist or exported functions are undefined.

- [ ] **Step 3: Implement deterministic parser and weighted restaurant ranking**

Implement `parseDemoRequest` with explicit Traditional Chinese keyword rules for `今天／明天`, `早餐／午餐／晚餐`, `鹹／甜／辣`, and `預算\s*(\d+)`. Implement `rankRestaurants` with normalized components: distance 30%, rating 25%, budget 20%, taste 15%, open status 10%; exclude closed restaurants and restaurants beyond `maxDistance`.

- [ ] **Step 4: Add invitation, time-window, and group-capacity tests**

```js
test('groups active intents into now, later, and tomorrow', () => {
  const now = new Date('2026-10-07T12:00:00+08:00');
  const result = logic.groupIntentsByWindow([
    { id: 'a', startAt: '2026-10-07T12:15:00+08:00', status: 'active' },
    { id: 'b', startAt: '2026-10-07T18:30:00+08:00', status: 'active' },
    { id: 'c', startAt: '2026-10-08T12:00:00+08:00', status: 'active' },
  ], now);
  assert.deepEqual(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.map(x => x.id)])), {
    now: ['a'], later: ['b'], tomorrow: ['c'],
  });
});

test('rejects a repeated invitation after decline', () => {
  const now = new Date('2026-10-07T12:00:00+08:00');
  const intent = { id: 'i1', userId: 'u2', status: 'active', expiresAt: '2026-10-07T14:00:00+08:00' };
  const invitations = [{ senderUserId: 'u1', recipientUserId: 'u2', mealIntentId: 'i1', status: 'declined' }];
  assert.equal(logic.canInvite('u1', 'u2', intent, invitations, now).ok, false);
});

test('prevents joining a full group', () => {
  assert.equal(logic.canJoinGroup({ capacity: 3, memberIds: ['a', 'b', 'c'], status: 'open' }).ok, false);
});
```

- [ ] **Step 5: Implement remaining pure functions and rerun tests**

Run: `node --test meal-buddy-demo/tests/logic.test.js`

Expected: all parsing, ranking, time grouping, invitation, expiration, and capacity tests PASS.

### Task 2: Mobile App Shell and Visual System

**Files:**
- Create: `meal-buddy-demo/index.html`
- Create: `meal-buddy-demo/styles.css`

**Interfaces:**
- Consumes: IDs and entity names from `data.js` and `logic.js`.
- Produces: `#app`, `[data-view]` screens, `#bottomNav`, `#inviteSheet`, `#profileDialog`, `#toast`, and reusable `.restaurant-card`, `.buddy-card`, `.group-card` styles consumed by `app.js`.

- [ ] **Step 1: Create the semantic application shell**

Include one `<main id="app">`, four view sections (`home`, `buddies`, `meals`, `profile`), a native `<dialog id="profileDialog">`, a bottom sheet `<section id="inviteSheet" hidden>`, an `aria-live="polite"` toast, and four labeled bottom-navigation buttons. Load `data.js`, `logic.js`, and `app.js` with `defer` in that order.

- [ ] **Step 2: Implement the mobile-first design system**

Define warm food colors, a green companion status, 44px minimum touch targets, visible focus states, safe-area bottom padding, and a `max-width: 430px` app canvas. At desktop widths, center the canvas on a muted background with a restrained shadow; below 430px, remove outer frame decoration and use the full width.

- [ ] **Step 3: Add core components and responsive states**

Style the voice hero, parsed criteria chips, restaurant cards, avatar stacks, three time tabs, profile rows, group capacity indicators, invitation mode control, status badges, empty state, loading state, and bottom navigation. Ensure images use fixed aspect ratios and `object-fit: cover`.

- [ ] **Step 4: Run structural checks**

Run:

```powershell
Select-String -Path meal-buddy-demo/index.html -Pattern 'id="app"','id="inviteSheet"','id="profileDialog"','aria-live="polite"'
Select-String -Path meal-buddy-demo/styles.css -Pattern 'max-width: 430px','min-height: 44px','focus-visible'
```

Expected: every required selector or accessibility attribute is found.

### Task 3: Home, Simulated Voice, and Restaurant Recommendations

**Files:**
- Create: `meal-buddy-demo/app.js`
- Modify: `meal-buddy-demo/index.html`
- Modify: `meal-buddy-demo/styles.css`

**Interfaces:**
- Consumes: `window.MealBuddyData`, `MealBuddyLogic.parseDemoRequest`, and `MealBuddyLogic.rankRestaurants`.
- Produces: `renderHome()`, `startVoiceDemo()`, `renderParsedCriteria(criteria)`, `renderRestaurantList(restaurants)`, and `openRestaurant(restaurantId)`.

- [ ] **Step 1: Add initial state and delegated events**

Create one state object containing `view`, `criteria`, `selectedRestaurantId`, `timeWindow`, `invitations`, `groups`, and `toast`. Use event delegation on `#app` and `#bottomNav`; do not attach one listener per card.

- [ ] **Step 2: Implement simulated microphone flow**

On voice-button activation, cycle through `listening`, `understanding`, and `complete`. Use the fixed transcript `明天午餐想吃鹹的，預算100元，附近有人一起吃更好`, call `parseDemoRequest`, display editable criteria chips, and label the result `AI Demo 模擬解析`.

- [ ] **Step 3: Render ranked restaurant cards**

Each card must show name, category, open state, estimated price, distance, fictional rating and rating count, match score, current interest count, tomorrow interest count, and a button labeled `看看誰想吃`. Sorting must come from `rankRestaurants`, not hard-coded card order.

- [ ] **Step 4: Verify the primary flow in a browser**

Open `meal-buddy-demo/index.html` through the local preview server. Activate the microphone, wait for completion, confirm the four parsed criteria, confirm ranked cards appear, and open one restaurant.

Expected: the interface moves from listening to parsed conditions to the selected restaurant without console errors.

### Task 4: Restaurant Intent Board and Buddy Profiles

**Files:**
- Modify: `meal-buddy-demo/app.js`
- Modify: `meal-buddy-demo/styles.css`
- Modify: `meal-buddy-demo/data.js`

**Interfaces:**
- Consumes: `groupIntentsByWindow`, profiles keyed by `userId`, restaurant IDs, and public groups.
- Produces: `renderRestaurantDetail()`, `setTimeWindow(window)`, `openBuddyProfile(userId, intentId)`, and `openGroup(groupId)`.

- [ ] **Step 1: Render restaurant detail and time tabs**

Show restaurant summary followed by `現在`, `等等`, and `明天` tabs with live counts. Use `groupIntentsByWindow` to populate each tab and preserve the selected tab when returning from a profile.

- [ ] **Step 2: Render buddy cards and group cards**

Buddy cards show one real-looking fictional photo, nickname, age range, proposed time, meal style, up to three interests, verification state, meal count, on-time rate, and rating. Group cards show host, time, description, member avatars, `current/capacity`, and whether approval is required.

- [ ] **Step 3: Implement profile dialog**

The dialog includes the full profile information and two actions: `邀他一起吃` and `邀請加入飯局`. It must include a visible notice that this is a friendship-only meal platform and show no contact details.

- [ ] **Step 4: Verify time filtering and profiles**

Switch through all three time tabs, open profiles from each populated tab, close the dialog by button and Escape, and open a public group.

Expected: counts and cards match seed data, dialog focus is managed natively, and no personal location or contact data appears.

### Task 5: One-to-One Invitations and Public Group Meals

**Files:**
- Modify: `meal-buddy-demo/app.js`
- Modify: `meal-buddy-demo/styles.css`
- Modify: `meal-buddy-demo/tests/logic.test.js`

**Interfaces:**
- Consumes: `canInvite`, `createInvitation`, `canJoinGroup`, selected profile, intent, and group state.
- Produces: `openInviteSheet(mode, target)`, `submitInvitation()`, `applyToGroup(groupId)`, `createDemoGroup()`, and `renderMeals()`.

- [ ] **Step 1: Build invitation bottom sheet**

Support `一對一` and `加入我的多人飯局` modes. Include selected person, restaurant, proposed time, an editable invitation message, existing-group selection for group mode, cancel, and send actions.

- [ ] **Step 2: Enforce invitation rules**

Before sending, call `canInvite`. Disable sending for expired intents, self-invitation, a previously declined duplicate, or an existing pending invitation. On success, call `createInvitation`, add it to state, close the sheet, and announce success through the toast.

- [ ] **Step 3: Implement public group application and group creation demo**

Allow application only when `canJoinGroup` succeeds. Add a compact group-creation flow for restaurant, time, capacity from 2 to 6, short description, and approval-required toggle. New groups appear immediately on the restaurant and meals views.

- [ ] **Step 4: Render invitation and meal status**

The meals view has `收到`, `送出`, and `已加入` sections. Demo controls may simulate `接受`, `婉拒`, and `已確認`; accepted invitations produce a demonstration conversation entry.

- [ ] **Step 5: Add and run transition tests**

Add tests asserting that `createInvitation` always creates `pending` status, a stable expiration, and the correct optional `mealGroupId`. Run:

`node --test meal-buddy-demo/tests/logic.test.js`

Expected: all tests PASS.

### Task 6: Accessibility, Persistence, and End-to-End Verification

**Files:**
- Modify: `meal-buddy-demo/app.js`
- Modify: `meal-buddy-demo/index.html`
- Modify: `meal-buddy-demo/styles.css`
- Modify: `.claude/launch.json` only if required to preview the new demo.

**Interfaces:**
- Consumes: all prior components and state.
- Produces: a finished browser demo at `meal-buddy-demo/index.html`.

- [ ] **Step 1: Add session persistence**

Persist only demo criteria, selected time tab, local invitations, and locally created groups in `sessionStorage` under `mealBuddyDemo.v1`. Never persist simulated private profile data or exact coordinates.

- [ ] **Step 2: Complete keyboard and screen-reader behavior**

Ensure every icon button has a visible label or `aria-label`, tabs use `role="tablist"`, `role="tab"`, and `aria-selected`, status updates use the toast live region, and reduced-motion users do not receive animated microphone pulses or sheet transitions.

- [ ] **Step 3: Run automated logic tests**

Run: `node --test meal-buddy-demo/tests/logic.test.js`

Expected: all tests PASS with zero skipped tests.

- [ ] **Step 4: Verify desktop and mobile layouts**

Inspect at 390×844, 320×700, and a desktop width of at least 1024px. At every width verify no horizontal overflow, all touch targets remain reachable, the bottom navigation does not cover content, and dialogs/sheets remain inside the viewport.

- [ ] **Step 5: Verify complete user journeys**

Journey A: voice demo → criteria → restaurant → current buddy → profile → one-to-one invite → sent status.

Journey B: nearby restaurant → tomorrow tab → public group → apply → joined status.

Journey C: restaurant → create group → invite a buddy into that group → group appears under meals.

Expected: all three journeys complete without reloads, dead ends, or console errors.

- [ ] **Step 6: Verify scope and untouched files**

Run:

```powershell
Get-Item index.html,index-jev.html | Select-Object Name,Length,LastWriteTime
Get-ChildItem -Recurse meal-buddy-demo | Select-Object FullName,Length
```

Expected: the existing apps remain present and the finished demo consists only of the documented new files plus an optional preview configuration entry.

