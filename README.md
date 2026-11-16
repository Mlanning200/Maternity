# Little One

A tiny iPhone web app for the first weeks with a newborn: breastfeeding timer, diapers,
a medicine timer, and a daily note + Bible verse (NIV). Shared live between two phones.

**This repo holds only the app's code. No personal data is ever stored here.**
Your entries live in a separate *private* repo (`maternity-data`) that only your phones can reach.

## One-time setup (about 10 minutes)

### 1. Put the app online
1. In this repo: **Settings → General → Danger Zone → Change visibility → Public**.
2. **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**,
   choose the branch with the app code (e.g. `main`), folder **/ (root)**, and click **Save**.
3. After a minute the app is at https://mlanning200.github.io/Maternity/ (the capital M matters).

### 2. Make the private data repo
1. Go to <https://github.com/new>.
2. Name it `maternity-data`, choose **Private**, and click **Create repository**. Leave it empty; the app fills it.

### 3. Make an access token (lets the app save to that repo, and nothing else)
1. Go to <https://github.com/settings/personal-access-tokens/new> (fine-grained token).
2. Name: `Little One`. Expiration: pick the longest option offered.
3. Repository access: **Only select repositories** → `maternity-data`.
4. Permissions → Repository permissions → **Contents: Read and write**.
5. Click **Generate token** and copy it (it starts with `github_pat_`).

### 4. Your iPhone
1. Open the app link in **Safari** → **Share** → **Add to Home Screen**.
2. Open **Little One** from your Home Screen (not Safari: the home-screen app keeps its own storage).
3. Enter `your-username/maternity-data` and paste the token → **Connect**.
4. In Settings, fill in the baby's name and birthday.

### 5. Her iPhone
1. On your phone: **Settings → Copy setup code for the other phone**, then text or AirDrop it to her.
2. On her phone: add the app to the Home Screen as above, open it, paste the code → **Connect**.

## Using it
- **Today**: tap **Left** or **Right** to start a feed, **Switch** sides, **Stop**. The side to start
  on next is marked. Tap any entry to fix the time or delete it. Every action can be undone for 5 seconds.
- **Notes for her** (Settings → Open notes): write notes ahead of time, each for a day of the baby's
  life (Day 1 = birthday). Set a PIN to keep them a surprise.
- **Medicine**: shows when the next dose is OK. Hours between doses are set in Settings.
- Diapers, medicine and verses can each be hidden in Settings.

## If something goes wrong
- **"Sign-in issue"** badge: the token expired. Make a new one (step 3), then Settings → Disconnect
  and connect again on each phone.
- **"Offline"**: changes are kept on the phone and sync when it's back online.
- All data is in `maternity-data/data.json`, readable anytime on GitHub.
