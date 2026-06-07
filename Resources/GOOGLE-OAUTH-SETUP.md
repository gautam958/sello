# Google OAuth Setup Guide for Sello

This guide provides step-by-step instructions to set up Google OAuth 2.0 credentials for your Sello Marketplace application.

---

## Prerequisites

- A Google account
- Access to [Google Cloud Console](https://console.cloud.google.com/)

---

## Step 1: Create or Select a Google Cloud Project

### If you don't have a project:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"Select a project"** dropdown at the top
3. Click **"New Project"**
4. Enter project name: `Sello Marketplace` (or your preferred name)
5. Select your organization (if prompted)
6. Click **"Create"**

### If you have an existing project:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"Select a project"** dropdown
3. Select your existing project

---

## Step 2: Enable Google+ API

1. In the left sidebar, go to **"APIs & Services"** → **"Library"**
2. In the search bar, type **"Google+"**
3. Click on **"Google+ API"**
4. Click **"Enable"**
5. Wait for the API to be enabled (page will refresh)

> **Note:** Even though Google+ is deprecated, the Google OAuth API still uses it internally for profile data.

---

## Step 3: Configure OAuth Consent Screen

1. In the left sidebar, go to **"APIs & Services"** → **"OAuth consent screen"**
2. Select user type: **"External"** → Click **"Create"**

### App Registration Details:
| Field | Value |
|-------|-------|
| App name | `Sello Marketplace` |
| User support email | Your email address |
| Developer contact email | Your email address |

### Scopes Configuration:
1. Click **"Add or Remove Scopes"**
2. Select the following scopes (check the boxes):
   - `.../auth/userinfo.email` - See your primary Google Account email
   - `.../auth/userinfo.profile` - See your personal info, including any personal info you've made publicly available
3. Click **"Save and Continue"**

### Test Users (Optional but Recommended):
1. Click **"Add Users"**
2. Enter your Google email address
3. Click **"Add"**
4. This allows you to test the OAuth flow before publishing

### Review Summary:
1. Click through the remaining steps
2. Click **"Back to Dashboard"**

---

## Step 4: Create OAuth 2.0 Credentials

1. In the left sidebar, go to **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** dropdown
3. Select **"OAuth client ID"**

### Configure OAuth Client:

| Field | Value |
|-------|-------|
| Application type | Web application |
| Name | `Sello Web Client` |

### Authorized Redirect URIs:
1. In the **"Authorized redirect URIs"** section, click **"Add URI"**
2. Enter your redirect URI based on your deployment:

**For Azure App Service:**
```
https://YOUR-APP-NAME.azurewebsites.net/auth/google/callback
```
Replace `YOUR-APP-NAME` with your actual Azure App Service name.

**For Local Development:**
```
http://localhost:3000/auth/google/callback
```

3. Click **"Create"**

### Copy Your Credentials:
A modal will appear with your credentials:

```
Your Client ID: 
your-client-id-here.apps.googleusercontent.com

Your Client Secret: 
GOCSPX-xxxxxxxxxxxxxxxxxxxxxxx
```

**⚠️ IMPORTANT:** Copy and save these credentials immediately. The Client Secret will only be shown once.

---

## Step 5: Set Up Environment Variables in Azure

### Option A: Azure Portal (Recommended)

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to your App Service
3. In the left menu, click **"Settings"** → **"Environment variables"**
4. Under **"App settings"**, click **"+ Add"** for each variable:

| Name | Value |
|------|-------|
| `GOOGLE_CLIENT_ID` | `your-client-id.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-xxxxxxxxxxxxxxxx` |
| `GOOGLE_CALLBACK_URL` | `https://YOUR-APP-NAME.azurewebsites.net/auth/google/callback` |

5. Click **"Apply"**
6. Click **"Continue"**
7. Click **"Save"**
8. **Restart** your App Service for changes to take effect

### Option B: Azure CLI

```bash
az webapp config appsettings set \
  --resource-group YOUR-RESOURCE-GROUP \
  --name YOUR-APP-NAME \
  --settings \
  GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="GOCSPX-xxxxxxxxxxxx" \
  GOOGLE_CALLBACK_URL="https://YOUR-APP-NAME.azurewebsites.net/auth/google/callback"
```

---

## Step 6: Verify Your Setup

### Test Locally (Optional):

1. Add credentials to a `.env` file:
```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxx
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

2. Make sure your Azure redirect URI includes `http://localhost:3000`

3. Run your app and test the OAuth flow

### Verify Redirect URI:
- Go back to Google Cloud Console → Credentials
- Click on your OAuth 2.0 Client
- Confirm the redirect URI is correctly set

---

## Common Issues & Troubleshooting

### Issue: "This app isn't verified"
**Solution:** This appears for unverified apps. Add your test email as a test user (Step 3).

### Issue: "Redirect URI mismatch"
**Solution:** 
- Check the exact redirect URI in Azure matches exactly what you entered in Google Cloud Console
- Make sure no trailing slashes or typos
- Azure App Service URL format: `https://appname.azurewebsites.net`

### Issue: Invalid client secret
**Solution:** 
- Re-copy the client secret from Google Cloud Console
- Make sure no extra spaces or characters

### Issue: OAuth not working after Azure deployment
**Solution:**
- Verify environment variables are set correctly in Azure
- Restart the App Service
- Check Azure Kudu console logs for errors

---

## Security Best Practices

1. **Never commit credentials to git** - Use environment variables only
2. **Use HTTPS** - Google requires HTTPS for OAuth
3. **Rotate credentials** - If compromised, delete and create new credentials
4. **Limit test users** - Only add trusted emails as test users before publishing

---

## Quick Reference

| Item | Where to Find |
|------|---------------|
| Google Cloud Console | https://console.cloud.google.com/ |
| Credentials Page | APIs & Services → Credentials |
| OAuth Consent | APIs & Services → OAuth consent screen |
| Azure App Settings | Azure Portal → Your App Service → Environment variables |

---

## Need Help?

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Passport.js Google Strategy](https://www.passportjs.org/packages/passport-google-oauth20/)
- [Azure App Service Configuration](https://docs.microsoft.com/en-us/azure/app-service/configure-common)