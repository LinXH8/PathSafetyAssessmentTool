# 10. Jira — Bug Tracking & Task Management

We use **Jira** to log bug fixes, feature updates, and outstanding tasks for PSAT.

🔗 [Open Jira Board](https://home.atlassian.com/o/99e7c896-5c8b-4caa-862f-7748a1d371a2/?cloudId=2c0f6e4f-e77f-4186-a61e-3ac305382a3f)

---

## Table of Contents

- [10.1 How to Log In](#101-how-to-log-in)
- [10.2 Viewing the Board & Outstanding Tasks](#102-viewing-the-board--outstanding-tasks)
- [10.3 Viewing Bugs Specifically](#103-viewing-bugs-specifically)
- [10.4 Creating a New Ticket](#104-creating-a-new-ticket-bug-task-or-feature)
- [10.5 Editing an Existing Ticket](#105-editing-an-existing-ticket)
- [10.6 Moving a Ticket Through the Workflow](#106-moving-a-ticket-through-the-workflow)
- [10.7 Closing / Resolving a Ticket](#107-closing--resolving-a-ticket)
- [10.8 Tips](#108-tips)

---

## 10.1 How to Log In

Access to the Jira board requires the shared project Google account:

| Field | Value |
|---|---|
| **Email** | psat.dev.ai@gmail.com |
| **Login method** | Google (Continue with Google) |

### 10.11 Steps

1. Click the **Open Jira Board** link above.
2. On the Atlassian login screen, click **Continue with Google**.
3. When prompted to choose a Google account, select or enter **psat.dev.ai@gmail.com**.
4. Complete the Google sign-in. You will be redirected to the PSAT Jira workspace.

> **Note:** The password for `psat.dev.ai@gmail.com` is held by the project lead. Contact them if you need access for the first time.

---

## 10.2 Viewing the Board & Outstanding Tasks

The **Board** view gives you an overview of all work, organised by status column.

1. After logging in, click **Projects** in the top navigation bar and select the **PSAT** project.
2. In the left sidebar, click **Board** to see the Kanban-style columns:
   - **To Do** — tasks not yet started
   - **In Progress** — work currently being done
   - **In Review** — waiting for review or testing
   - **Done** — completed items
3. To see **only outstanding tasks**, click the **To Do** column or use the **Backlog** view (left sidebar → **Backlog**) for the full prioritised list.
4. Use the **filter bar** at the top of the board to filter by:
   - **Assignee** — show only your own tickets
   - **Type** — Bug, Task, Story, etc.
   - **Priority** — Highest, High, Medium, Low
5. Click any ticket card to open its detail panel and read the full description.

---

## 10.3 Viewing Bugs Specifically

1. In the left sidebar, click **Issues** (or use the top search bar).
2. Click **View all issues**.
3. In the **Type** filter, select **Bug**.
4. All open bug reports will be listed. Click any row to open the bug detail.

---

## 10.4 Creating a New Ticket (Bug, Task, or Feature)

1. Click the **+ Create** button in the top navigation bar.
2. Fill in the form:
   - **Project** — select *PSAT*
   - **Issue Type** — choose *Bug*, *Task*, or *Story*
   - **Summary** — a short, clear title (e.g. `Fix: Road Network layer showing Unknown in GIS page`)
   - **Description** — explain the issue or task in detail. For bugs, include:
     - Steps to reproduce
     - What you expected to happen
     - What actually happened
     - Any screenshots or error messages
   - **Priority** — set appropriately (Highest / High / Medium / Low)
   - **Assignee** — assign to yourself or leave unassigned if unsure
3. Click **Create**. The ticket appears in the **To Do** column on the board.

---

## 10.5 Editing an Existing Ticket

1. Open the ticket by clicking its card on the board or finding it via **Issues**.
2. Click directly on any field to edit it inline:
   - **Summary** (title) — click the title text to edit
   - **Description** — click the description body to open the editor
   - **Assignee** — click the assignee field and select a team member
   - **Priority** — click the priority icon to change it
   - **Status** — click the status badge (e.g. *To Do*) and select a new status from the dropdown
3. Changes save automatically as you update each field.
4. To add a **comment** (e.g. progress update or question), scroll to the bottom of the ticket and type in the **Add a comment** box, then click **Save**.

---

## 10.6 Moving a Ticket Through the Workflow

| Status | When to use |
|---|---|
| **To Do** | Not yet started |
| **In Progress** | You have started working on it — assign yourself |
| **In Review** | Code is written and a PR is open; waiting for review |
| **Done** | Fix is merged, tested, and verified |

To move a ticket:
- **On the board** — drag the card to the next column.
- **Inside the ticket** — click the status badge at the top and pick the new status.

---

## 10.7 Closing / Resolving a Ticket

1. Open the ticket.
2. Click the status badge and select **Done**.
3. Optionally add a comment describing what was done and which commit or PR resolved it.

---

## 10.8 Tips

- **Link related tickets** — inside a ticket, click **Link** to connect it to another issue (e.g. a bug that blocks a task).
- **Attach files** — drag and drop screenshots or log files directly into the ticket description or comment box.
- **Use labels** — add labels like `frontend`, `backend`, `gis`, or `scoring` to make filtering easier.
- **Watch a ticket** — click the eye icon on a ticket to get notified when it is updated.
