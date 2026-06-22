# 6. User Accounts & Sign-In

PSAT uses a local profile system. Each user creates a named profile secured by a 4–12 digit numeric PIN. Profiles and all associated projects persist on disk — users can always sign back in on the same device to access previously saved work.

---

## Table of Contents

- [6.1 How a User Signs In](#61-how-a-user-signs-in)
- [6.2 Creating a New Account](#62-creating-a-new-account)
- [6.3 Switching Between Accounts](#63-switching-between-accounts)
- [6.4 Session Behaviour](#64-session-behaviour)

---

### 6.1 How a User Signs In

1. Open PSAT. The **Landing Page** lists all profiles registered on this device.
2. Click the desired profile to select it (highlighted in green).
3. Click **Start As \<LTA Email Address\>**. A PIN prompt appears if this is not the currently active session.
4. Enter the PIN and confirm. The user is now logged in and taken to their Projects page.
5. All previously saved projects for that profile are immediately available.

### 6.2 Creating a New Account

1. On the Landing Page, click **Create Profile**.
2. Enter the user's LTA Employee Email, division, and a 4–12 digit numeric PIN.
3. Click **Create Profile**. The profile is saved and the user is automatically logged in.

> Profile data (name, division, PIN hash) is stored locally in `profiles/<slug>/profile.json`. No external authentication server is involved.

### 6.3 Switching Between Accounts

1. Click **Log Out** in the sidebar at any time. This returns to the Landing Page.
2. Select a different profile from the list.
3. Enter that profile's PIN to sign in.

### 6.4 Session Behaviour

- The active session is **device-local**. All open browser tabs on the same device share the same active profile.
- Logging out from one tab affects all open tabs on that device — they will redirect to the Landing Page on their next action.
- There is no automatic session timeout. Users remain logged in until they explicitly click Log Out.
- If a user forgets their PIN, an administrator must delete the profile folder (`profiles/<slug>/`) and have the user create a new one. **There is no PIN reset mechanism** — deleting the folder also deletes all projects under that profile.
