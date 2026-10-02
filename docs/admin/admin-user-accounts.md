# 6. User Accounts & Sign-In

PSAT uses its own profile system. Each user creates a profile with a username, an email, a division, and a 4–12 digit numeric PIN. Profiles and their projects are stored on disk, so users can always sign back in to reach previously saved work. The desktop app and the cloud deployment behave the same way.

---

## Table of Contents

- [6.1 How a User Signs In](#61-how-a-user-signs-in)
- [6.2 Creating a New Account](#62-creating-a-new-account)
- [6.3 The Shared Islandwide Profile](#63-the-shared-islandwide-profile)
- [6.4 Managing and Switching Accounts](#64-managing-and-switching-accounts)
- [6.5 Admin Accounts](#65-admin-accounts)
- [6.6 Session Behaviour](#66-session-behaviour)
- [6.7 Forgotten PINs](#67-forgotten-pins)

---

### 6.1 How a User Signs In

The Landing Page does not list personal profiles, so one user cannot see who else has an account.

1. Open PSAT and click **Log in with email and PIN**.
2. Enter the email on the profile and its PIN, then click **Log In**.
3. The user is taken to their Projects page with all previously saved projects available.

Profiles created before emails were introduced have their old profile name stored as the email; those users type that name in the email box. A username is also accepted there.

### 6.2 Creating a New Account

1. On the Landing Page, click the **+** button in the Profiles panel.
2. Enter a username, the user's LTA Employee Email, division, and a 4–12 digit numeric PIN.
3. Click **Create Profile**. The profile is saved and the user is automatically logged in.

> Profile data (username, email, division, PIN hash) is stored in the registry file `profiles/profiles.json`; each profile's projects live under `profiles/<slug>/projects/`. No external authentication server is involved, and emails are not verified.

### 6.3 The Shared Islandwide Profile

**Islandwide Data** ships with the app, is the only profile shown on the Landing Page, and is opened by everyone with the same shared PIN.

Because it is shared, it is locked:

- its username, email, division and PIN cannot be changed, and its PIN cannot be reset through **Forgot PIN?**
- the profile cannot be deleted
- the project inside it cannot be deleted or renamed
- other profiles cannot share projects into it

Users can still share a copy of its project out to their own profile and work on that copy. Edits made inside the Islandwide project itself (attribute changes, treatments, segment deletions) are not blocked and affect everyone who uses it.

### 6.4 Managing and Switching Accounts

- **Manage:** after logging in, **My Account** in the sidebar edits the logged-in profile's details, changes its PIN, or deletes it. The current PIN is required. Deleting a profile deletes all its projects.
- **Switch:** click **Logout**, then **Log in with email and PIN** with the other profile's details.
- **Share projects:** in the Share dialog, type the recipient's email. If several profiles use that email, type the recipient's username instead.

### 6.5 Admin Accounts

An admin can see a read-only list of every account (username and division), for usage tracking.

- **Who is an admin:** any profile whose email is listed in the `PSAT_ADMIN_EMAILS` setting (comma separated). On the cloud server this goes in the `.env` file next to `docker-compose.yml`, followed by `sudo docker compose up -d`. It is not stored in the repository.
- **How to view:** log in as that profile and click **Accounts** in the sidebar. The button only appears for admins, and the list is only available while logged in.
- **What it does not do:** it gives no access to other profiles or their projects.

Do not use the Islandwide profile's email as an admin email: everyone can log in to that profile, so everyone would be an admin. Because emails are not verified, anyone who creates a profile with an admin's email also becomes an admin.

### 6.6 Session Behaviour

- A login belongs to one browser. All tabs in that browser share it, and logging out in one tab logs out the others on their next action.
- There is no automatic timeout. Users stay logged in on that browser, even after closing it, until they click **Logout**. On shared computers, users should log out when done.
- Nothing about a previous login is shown on the Landing Page after logging out.

### 6.7 Forgotten PINs

Users can reset their own PIN: **Log in with email and PIN** → **Forgot PIN?** → enter username, the email on the profile, and a new PIN. No email is sent; the email is only compared with the one on the profile.

If a user has forgotten their username, an admin can look it up on the **Accounts** page. If they no longer know the email on their profile, the remaining option is to delete the profile folder (`profiles/<slug>/`) and its entry in `profiles/profiles.json`, and have the user create a new profile — this also deletes all projects under that profile.
