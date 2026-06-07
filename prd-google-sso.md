# PRD: Google Single Sign-On (SSO) Implementation

## 1. Introduction/Overview

Add Google OAuth 2.0 authentication to Sello Marketplace, allowing users to sign in with their Google account as an alternative to username/password. This enhances user experience by reducing registration friction and leveraging trusted Google credentials.

## 2. Goals

- Allow users to sign in with Google alongside existing username/password
- Store comprehensive Google user profile data (name, email, profile picture, Google ID)
- Maintain separate Google-only accounts without merging with existing credentials
- Integrate seamlessly with Azure App Service deployment
- Follow security best practices using Passport.js

## 3. User Stories

### US-001: Google OAuth Setup
**Description:** As a developer, I need to configure Google OAuth credentials so the application can authenticate with Google.

**Acceptance Criteria:**
- [ ] Create Google Cloud project and configure OAuth consent screen
- [ ] Generate Client ID and Client Secret
- [ ] Add credentials to Azure App Service environment variables
- [ ] Configure authorized redirect URI for Azure deployment

### US-002: Backend OAuth Routes
**Description:** As a developer, I need to implement server-side OAuth routes so Google authentication works.

**Acceptance Criteria:**
- [ ] Install passport.js and passport-google-oauth20 package
- [ ] Configure Passport GoogleStrategy with credentials from env vars
- [ ] Create `/auth/google` route to initiate OAuth flow
- [ ] Create `/auth/google/callback` route to handle OAuth callback
- [ ] Create `/auth/google/success` route to issue JWT after successful auth
- [ ] Handle both new user creation and existing user scenarios

### US-003: User Data Storage
**Description:** As a developer, I need to store Google user data so user profiles are complete.

**Acceptance Criteria:**
- [ ] Add Google-specific fields to user object (googleId, googleName, googlePicture, googleEmail)
- [ ] Create new users with Google provider when first signing in
- [ ] Preserve existing username/password accounts as separate entities
- [ ] Store profile picture URL for display in UI

### US-004: Login Page UI Updates
**Description:** As a user, I want to see a Google sign-in button on the login page.

**Acceptance Criteria:**
- [ ] Add prominent "Sign in with Google" button above existing form
- [ ] Button uses official Google branding (colors, logo)
- [ ] Button opens OAuth flow in same window (redirect)
- [ ] Maintain existing username/password form below Google button

### US-005: OAuth Callback Handling
**Description:** As a user, I want to be redirected to the app after Google sign-in.

**Acceptance Criteria:**
- [ ] After successful Google auth, redirect to main app page
- [ ] Store auth token in localStorage
- [ ] Display toast notification: "Signed in with Google!"
- [ ] Show user name in header if logged in
- [ ] Handle errors gracefully with error message

### US-006: User Session Management
**Description:** As a user, I want my Google session to persist so I don't re-authenticate often.

**Acceptance Criteria:**
- [ ] JWT token issued on successful Google auth
- [ ] Token includes userId, username, email, and isGoogleUser flag
- [ ] Token expires after 7 days
- [ ] Existing logout functionality works for Google users

## 4. Functional Requirements

### Backend (server.js)

- **FR-1:** Install dependencies `passport@^0.7.0` and `passport-google-oauth20@^2.0.0`
- **FR-2:** Configure Passport with GoogleStrategy using environment variables:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_CALLBACK_URL` (e.g., `https://your-app.azurewebsites.net/auth/google/callback`)
- **FR-3:** Add new user fields to users.json schema:
  ```json
  {
    "googleId": "string (optional)",
    "googleEmail": "string (optional)",
    "googleName": "string (optional)",
    "googlePicture": "string (optional)",
    "authProvider": "local" | "google"
  }
  ```
- **FR-4:** Create route `/auth/google` - initiates OAuth flow with Passport
- **FR-5:** Create route `/auth/google/callback` - handles OAuth callback, creates/retrieves user
- **FR-6:** On callback success, create JWT token with user data and redirect to frontend
- **FR-7:** On callback failure, redirect to login page with error message

### Frontend (login.html)

- **FR-8:** Add Google sign-in button with proper styling
- **FR-9:** Button click triggers redirect to `/auth/google`
- **FR-10:** Handle redirect back from OAuth flow (landing page checks for token in URL or localStorage)
- **FR-11:** Display appropriate loading state during OAuth flow
- **FR-12:** Show toast notification on successful Google sign-in

### Frontend (signup.html)

- **FR-13:** Add Google sign-up button above existing registration form
- **FR-14:** Button click triggers same `/auth/google` flow
- **FR-15:** On callback, auto-fill user data from Google profile

### Frontend (header/navigation)

- **FR-16:** Display Google profile picture in header when user is logged in via Google
- **FR-17:** Fall back to initial letter avatar if no profile picture

### Environment Configuration

- **FR-13:** Document required environment variables for Azure deployment
- **FR-14:** Provide setup instructions for Google Cloud Console

## 5. Non-Goals

- Account linking/merging between Google and existing accounts
- Google Sign-In SDK (JavaScript-only flow) - using server-side OAuth instead
- OAuth for other providers (Facebook, Apple, etc.)
- Two-factor authentication
- Changing Google account once signed in
- Deleting Google association from local account

## 6. Design Considerations

### UI/UX

- Google button should be visually prominent (primary action area)
- Use official Google "Sign in with Google" button styling
- Maintain familiar layout - Google button above traditional form
- Consistent error handling across both auth methods
- **Updated:** Add Google sign-in option to signup page as well
- **Updated:** Display Google profile picture in header after Google login

### Security

- Never log or expose Google tokens
- Store only necessary user data
- Use HTTPS for all OAuth communications
- Validate redirect URI matches configured value
- Generate secure random state parameter to prevent CSRF

## 7. Technical Considerations

### Dependencies

```json
{
  "passport": "^0.7.0",
  "passport-google-oauth20": "^2.0.0",
  "jsonwebtoken": "^9.0.0"
}
```

### Environment Variables (Azure)

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth Client Secret |
| `GOOGLE_CALLBACK_URL` | Full callback URL for Azure |
| `JWT_SECRET` | Secret for signing JWTs (use existing or add) |

### Google Cloud Console Setup

1. Create project or select existing
2. Enable Google+ API
3. Configure OAuth consent screen (External user type)
4. Add scopes: `email`, `profile`, `openid`
5. Add authorized domains (Azure domain)
6. Create OAuth 2.0 Client ID (Web application type)
7. Add authorized redirect URI: `{GOOGLE_CALLBACK_URL}/auth/google/callback`

### File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `package.json` | Modify | Add passport dependencies |
| `server.js` | Modify | Add Passport config and OAuth routes |
| `login.html` | Modify | Add Google sign-in button |
| `script.js` | Modify | Add OAuth callback handling |
| `.env.example` | Create | Document required env vars |

### OAuth Flow

```
User clicks "Sign in with Google"
    ↓
Redirect to Google OAuth consent page
    ↓
User grants permission
    ↓
Google redirects to /auth/google/callback with code
    ↓
Server exchanges code for tokens
    ↓
Server fetches user profile from Google
    ↓
Server creates/retrieves user in users.json
    ↓
Server issues JWT and redirects to frontend with token
    ↓
Frontend stores token and shows success message
```

## 8. Success Metrics

- Users can successfully sign in with Google in under 3 clicks
- No errors in Azure Application Insights logs related to OAuth
- Existing username/password users unaffected
- OAuth flow completes within 5 seconds
- Zero security vulnerabilities in OAuth implementation

## 9. Implementation Order

1. Set up Google Cloud Console project and OAuth credentials
2. Add environment variables to Azure
3. Install npm packages
4. Implement Passport.js configuration in server.js
5. Add OAuth routes to server.js
6. Update login.html with Google button
7. Update script.js for callback handling
8. Test full OAuth flow
9. Document setup in README or separate guide

## 10. Open Questions

- Should we add a "Continue with Google" option to signup page as well?
- Do you want the profile picture to display in the header after Google login?
- Should Google users be able to set a separate username within the app?
- Any specific error messages you want displayed for OAuth failures?