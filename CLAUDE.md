# Equilibria — project brief for Claude Code

## About me (the developer)
- I'm a student building this for CSTP 2107 (Advanced Internet Programming — React).
- I don't write code myself. I design in Google Stitch and build with Claude Code.
- Explain what you changed in plain language after each task, and keep steps small.
- Before any big feature, show me a plan and wait for my OK before writing code.
- After each step that works, remind me to test it and offer to commit.

## What Equilibria is
A calm, AI-integrated web app for people dealing with burnout (students first).
Users write in a diary, talk to an AI that knows their context, set small
recovery goals, keep a comfort kit for bad days, and write letters to their future self.

The core idea: **every feature shares one memory.** The diary, chat and goals
are linked, so the app gets more personal over time.

## Tech stack (current)
- React + Vite (dev server: `npm run dev` → http://localhost:5173)
- Tailwind CSS v4 (built via `tailwindcss -i ./src/App.css -o ./src/output.css`)
- Existing files include: `src/Page/LoginPage.jsx`, `src/Page/SignupPage.jsx`,
  `src/components/AuthProvider.jsx`, `src/components/Navbar.jsx`
- Package name is still `brd` (old project name) — rename to `equilibria` when convenient.
- Storage: start with `localStorage`. Move to a real database later if needed.
- Ask me before adding new libraries.

## Homepage (final — 5 tiles)
1. **Today card** (full width, top): one gentle sentence based on the user's recent
   diary/chat, an optional "past you" quote from their own old diary entry, and two
   buttons: **Talk it out** (opens AI chat) and **Just write** (opens diary).
2. **My diary** (wide): latest entry preview, mood tags, "+ New entry", voice entry icon.
3. **My goals**: active goal(s) with checkboxes, plus AI-suggested goals
   ("Add" / "Not now"). Suggestions are never added automatically.
4. **Comfort kit**: user-chosen items — a song, a photo, a person to call,
   a calm place, a note to self. One tap each.
5. **Letter to future you**: write a letter that unlocks after 1 week / 1 month / 3 months.
   Tile states: "Write your first letter" → "1 sealed · opens <date>" → "Ready to open".
   On unlock day, the Today card announces it. After reading: "Write back to future you?"

Navigation: Home, Diary, Goals, Chat (top nav on desktop, bottom tabs on mobile).
There is NO sleep check, NO weekly pattern tile, NO battery level (all removed on purpose).

## How the features connect (shared memory)
- After each diary entry or chat session, an AI "extractor" call turns the text into a
  small summary, e.g.:
  ```json
  { "date": "2026-11-07", "source": "diary", "mood": "anxious", "energy": 3,
    "stressors": ["midterm", "poor sleep"], "positives": ["coffee with a friend"],
    "summary": "Stressed about midterm, slept badly, coffee helped a bit" }
  ```
- These summaries are stored and used by:
  - **AI chat**: recent summaries go into the system prompt so the chat knows the
    user's background ("You mentioned your midterm — how did it go?").
    Refer to diary content gently; never quote whole entries back.
  - **Goals**: suggest one small goal only after a pattern (e.g. 3+ similar entries),
    not after one bad day.
  - **Today card**: picks the message and which button to emphasize.
  - **Comfort kit**: chat can offer it on a rough day ("Want to open your comfort kit?").
- Chat can turn something into a goal ("Want me to make that a goal?") and can save a
  short summary to the diary if the user agrees.

## First-time user flow
Welcome → privacy consent ("Can Equilibria use your diary to personalize chat and goals?")
→ 5 quick tap-based questions (mood, what's weighing on you, energy, what helps,
optional free text) → answers become the **Day 1 diary page** → recommended next step:
Talk it out / Set a small goal / Just look around.
Comfort kit setup is offered later (around day 3), not during onboarding.

## Design rules (calm UI)
- Background off-white `#F8FAFB`, primary forest green `#14532D`, leaf green `#2E9B5E`,
  sun yellow `#F6B93B` (accent, sparingly), mint `#E8F5EC`, headings `#111827`,
  body text `#6B7280`, borders `#E5E7EB`.
- Fonts: Plus Jakarta Sans (headings), Inter (UI), a serif (diary text and quotes).
- Rounded corners ~20px, generous whitespace, no shadows, gentle fades (300–400ms).
- **Never** use red, notification badges, unread counts, or punishing streaks.
- One main (filled) button per screen. Gentle wording: "Not now", not "Skip".
- Logo: mint rounded square with green hills and a yellow sun.

## Safety and privacy (non-negotiable)
- **Crisis handling:** if a diary entry or chat message suggests self-harm or crisis,
  immediately and gently show support resources (Canada: call or text 988), in both
  diary and chat. Never hide this behind settings.
- Show a clear note that Equilibria is not therapy or medical care.
- "Let AI read my diary" setting (default asked during onboarding), and a way to mark
  single entries as private (never sent to AI).
- A "What Equilibria knows about me" page to view and delete saved summaries.
- **Never put API keys in code or commit them to git.** Use `.env` files and make sure
  `.env` is in `.gitignore`.

## Build order
1. Homepage with the 5 tiles using placeholder data
2. Diary end to end: write → save → list past entries → show latest on homepage
3. AI: basic chat → chat reads diary summaries → AI writes the Today card
4. Onboarding questionnaire → creates the Day 1 diary page
5. Goals (incl. AI suggestions) → Comfort kit → Letter to future you
6. Settings, profile, privacy page, landing page fixes

## Landing page fixes (later)
- Replace "Pacing your workday" with copy that includes students.
- Remove "Bring your own API key" before real users see it.
- Slider labels mismatch ("Grounded & Clear" vs "Light & Clear") — pick one.
- "EXHALE SOFTLY" → sentence case.
