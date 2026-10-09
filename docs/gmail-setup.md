# Connect Gmail to NONON (one-time setup)

NONON reads your Gmail directly from Google. It does not use a connector service, and your mail and
sign-in never pass through any server of ours. Because NONON ships without a Google app of its own,
you create a free "Desktop app" login once. It takes about 10 minutes.

NONON asks for **read-only** Gmail access (`gmail.readonly`) and your email address. With that
permission it cannot send, draft, label, archive or delete anything.

## 1. Create a Google Cloud project

1. Open https://console.cloud.google.com and sign in with the Google account whose mail you want to read.
2. Click the project picker, then **New project**. Name it `NONON Gmail`. Create it.

## 2. Turn on the Gmail API

1. Open **APIs & Services > Library**, search for **Gmail API**, open it, click **Enable**.

## 3. Set up the consent screen

1. Open **APIs & Services > OAuth consent screen** (called **Google Auth Platform** in newer consoles).
2. Choose **External**. App name `NONON`. Add your own email as the support and contact address.
3. Under **Data access** (or **Scopes**), add `https://www.googleapis.com/auth/gmail.readonly`.
4. Under **Audience** (or **Test users**), keep the app in **Testing** and **add your own Gmail address as a test user**.

While the app is in Testing, only listed test users can sign in. Google shows an "unverified app"
warning: click **Advanced**, then **Go to NONON (unsafe)**. That warning is about your own app being
unreviewed; you are the only one using it. Google also expires Testing-mode sign-ins after 7 days,
so NONON may ask you to connect again about once a week. (Releasing this to the public would need
Google's app verification, because Gmail read access is a restricted scope.)

## 4. Create the Desktop login

1. Open **APIs & Services > Credentials > Create credentials > OAuth client ID**.
2. Application type: **Desktop app**. Name it `NONON desktop`. Create.
3. Click **Download JSON** on the new client.

## 5. Put the file where NONON looks

Save the downloaded file as **`google-client.json`** in NONON's data folder. When Gmail is not set
up, NONON's email settings show the exact path. For a development run it is
`<NONON_DATA_DIR>\google-client.json`, for example `E:\nonon-dev\data\google-client.json`.

Alternative: set two environment variables instead of saving the file:
`NONON_GOOGLE_CLIENT_ID` and `NONON_GOOGLE_CLIENT_SECRET`.

Do not paste this file or its contents into chat, email or a repository. It stays on your computer.

## 6. Connect

Open NONON, go to the email settings, choose **Connect Gmail**. Your browser opens Google's sign-in.
Approve the read-only permission. When the page says Gmail is connected, return to NONON.

## Disconnect or remove access

- In NONON choose **Disconnect**. That cancels the permission at Google and deletes the saved sign-in
  and the saved mail on this computer.
- You can also remove NONON at https://myaccount.google.com/permissions at any time.

## What NONON keeps on this computer

- The sign-in token, encrypted with your operating system's protection (Windows or macOS). If the
  system cannot encrypt it, NONON refuses to save it.
- A short-lived copy of recent mail (at most 200 messages, nothing older than 14 days) so a brief can
  be made offline. It is labelled with when it was last updated. Disconnect deletes it.
- The AI that reads your mail is the local one by default. Gmail itself is still Google's service;
  running the AI on this computer does not make Gmail offline.
