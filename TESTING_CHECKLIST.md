# Manual Test Checklist — everything since the last voice-message fix

Covers: Groups, Privacy Settings, Calls, and Profile Preview (plus the
cache-first login rebuild they all sit on top of). Go through in this
order — each section builds on the app being logged in correctly.

Legend: 🧍 = needs just you · 👥 = needs a second test account/device
(ideally two phones, since several of these are "does the other person
see it live" checks).

---

## 0. Login / session sanity 🧍
_(Quick check before anything else — the auth bootstrap was rebuilt.)_
- [ ] Close the app fully and reopen it — you land back on your chats
      instantly, no flash of a login screen or "Set up your profile" screen.
- [ ] Turn off wifi/data for a few seconds, reopen the app — it still shows
      your cached chats/profile instead of kicking you out.
- [ ] Log out, log back in — profile and chats load correctly.

---

## 1. Groups 🧍👥
- [ ] **Create a group**: pick a name, optional photo, add 2+ friends →
      group appears in the Groups tab immediately.
- [ ] **Send a message** in the group → it arrives for the other
      member(s) in real time (no refresh needed).
- [ ] **Group info screen**: tap the group's name/avatar in the chat
      header (no more ⋮ menu) → opens the full Group Info page, see the
      member list, your own role.
- [ ] **Mute/unmute the group** from Group Info → the toggle switch flips
      instantly on tap, no multi-second delay.
- [ ] **Add a member** to an existing group → they get added instantly on
      their end too.
- [ ] **Promote a member to admin**, then **demote** them (as the group
      creator/admin) → role badge updates for everyone live.
- [ ] **Tap a member's "⋮" button** (as admin) → the button clearly shows
      a pressed/active state, and the promote/demote/remove menu opens
      anchored right under that button (not in the top-left corner),
      fully visible and compact — try this on a member near the bottom of
      a long list too.
- [ ] **Remove a member** (as admin) → that person is immediately kicked
      out of the group on their device (shows "You are no longer in this
      group" and backs them out automatically).
- [ ] **Rename the group / change its photo** → updates live for all
      members without them needing to reopen the chat.
- [ ] **Leave a group yourself** → you're removed and it disappears from
      your Groups tab.
- [ ] **Delete a group** (as the creator) → it disappears for every
      member, not just you.
- [ ] Have someone **message you right after you've been removed/the
      group is deleted** — confirm no crash, no "ghost" messages appear.

---

## 2. Privacy Settings 🧍👥
_(Test each setting with a friend and with a non-friend if you can — "Contacts" should behave differently from "Everyone"/"Nobody".)_
- [ ] Open **Settings → Privacy** — current settings load (not stuck on
      a spinner, not reset to defaults every time you reopen).
- [ ] **Last seen**: set to "Nobody" → a friend viewing your chat/profile
      no longer sees your last-seen time (shows "Offline" or nothing
      instead of a timestamp).
- [ ] **Last seen = Contacts** → a friend sees it, a non-friend doesn't.
- [ ] **Profile photo**: set to "Nobody" → others see your initial-letter
      avatar instead of your real photo, in chats, group member lists,
      and the profile preview.
- [ ] **About/bio**: set to "Nobody" → others opening your profile don't
      see your bio text.
- [ ] **Read receipts off**: send a message to a friend, have them read
      it → you should NOT see a "read" checkmark (and this should also
      mean you don't see read receipts from others while it's off).
- [ ] **Online status off**: go online → friends should see you as
      offline/last-seen, not "Online right now".
- [ ] Change a setting, **force-close and reopen the app** → the setting
      stuck (didn't revert).
- [ ] **Blocked users list** (Settings → Blocked Users): block someone,
      confirm they appear here; unblock, confirm they disappear.
- [ ] As the **blocked person**: confirm you can no longer message or
      call the person who blocked you (should fail cleanly, not crash).

---

## 3. Calls (voice & video) 👥 — needs two devices
_(This was a full rebuild — test it thoroughly, it's the highest-risk area.)_
- [ ] **Place a voice call** to a friend → they get a ringing screen with
      your name/photo; audio connects both ways once answered.
- [ ] **Place a video call** → same, with both camera feeds showing.
- [ ] **Decline a call** (as the receiver) → caller sees "Call declined",
      not stuck on "Ringing" forever.
- [ ] **Let a call ring with no answer** → after ~45s it ends itself as
      "missed" on both sides, instead of ringing forever.
- [ ] **Hang up mid-call** from either side → the other person's call
      screen closes right away too (not just yours).
- [ ] **Tap the ✕ while it's still ringing (before anyone answers)** →
      confirm it actually cancels/declines rather than just closing your
      screen while the other phone keeps ringing.
- [ ] **Mute/unmute**, **toggle camera on/off**, **switch
      speaker/earpiece** during a call → all work and reflect correctly.
- [ ] **Call history tab**: after a few calls, confirm they show up with
      correct direction (incoming/outgoing/missed) and correct type icon
      (Voice vs Video — this had a bug before).
  - [ ] Filter by **Voice**, **Video**, **Missed** → each filter shows
        only the right entries.
- [ ] From call history, tap **call-back** and **message** buttons → they
      work.
- [ ] **Call a blocked user / be called by someone who blocked you** →
      should be rejected (not ring at all).
- [ ] **Receive a call while already on a call** → should auto-decline
      the second one, not glitch out.
- [ ] Put the app in the **background during a call** on Android/iOS →
      reasonable behavior on resume (call either still connected or
      cleanly ended, not a frozen screen).

---

## 4. Profile Preview (brand new) 🧍👥
_(No crashes, right info, right buttons for the relationship.)_
- [ ] **From a chat**: tap the contact's name/photo in the header → their
      profile opens (photo, name, username, bio if set, online/last-seen
      line — respecting whatever privacy settings they've chosen).
- [ ] **From a shared photo/video viewer** in a chat: tap the sender's
      name/photo at the top → profile opens the same way.
- [ ] **From Discover → Friends tab**: tap a friend's row (not the
      message/call icons) → profile opens with Message/Voice/Video
      buttons.
- [ ] **From Discover → Find tab**: tap someone you're not friends with →
      profile opens with an "Add friend" button instead of
      message/call.
- [ ] **From Discover → Requests tab**: tap the sender of a pending
      request → profile opens with Accept/Decline inline.
- [ ] **Send a friend request from the profile screen** → it updates to
      "Request sent · Cancel" without closing the screen.
- [ ] **Open a group → Group Info** (tap the chat header): tap a member's
      name/avatar (not yourself) → their profile opens; tapping
      **yourself** in the list does nothing (expected — no "view your own
      profile" from there).
- [ ] **From Call History**: tap a call entry's name/photo → profile
      opens for that person.
- [ ] **From inside the profile screen's "⋮" menu**: Remove friend, and
      separately Block → both ask for confirmation first, then actually
      take effect (friend disappears from your list / blocked user shows
      in Settings → Blocked Users).
- [ ] **Unblock from the profile screen** → works and immediately lets
      you message them again.
- [ ] Tap your **own** avatar/name anywhere this is wired up → it should
      take you to **Settings** (your editable profile), not open a
      read-only duplicate.

---

## What to report back if something fails
For anything that doesn't work as described, the most useful details are:
1. Which checklist item.
2. What you expected vs. what actually happened.
3. One account or two devices involved, and (for calls/privacy) what the
   privacy settings were at the time.
