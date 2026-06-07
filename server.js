require("dotenv").config();

const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS to accept requests from your production frontend site
// app.use(
//   cors({
//     origin: "https://gautam958.github.io",
//     methods: ["GET", "POST", "PUT", "DELETE"],
//     credentials: true,
//   }),
// );
const AZURE_URL = process.env.AZURE_BASE_URL || "";
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = ["https://gautam958.github.io", "http://localhost:3000"];
  if (AZURE_URL) allowed.push(AZURE_URL);
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Session configuration for OAuth flow
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const isProduction = process.env.NODE_ENV === "production" || AZURE_URL.includes(".azurewebsites.net");
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction, // true for HTTPS (Azure), false for HTTP (local dev)
      httpOnly: true,
      maxAge: 10 * 60 * 1000, // 10 minutes (just for OAuth flow)
    },
  })
);

app.use(express.json());

// Path Definitions - Lowercase folder matching production standard environments
const USERS_FILE = path.join(__dirname, "users.json");
const ITEMS_FILE = path.join(__dirname, "items.json");
const LOGS_FILE = path.join(__dirname, "logs.json");
const VISITORS_FILE = path.join(__dirname, "visitors.json");
const WISHLIST_FILE = path.join(__dirname, "wishlist.json");
const UPLOAD_DIR = path.join(__dirname, "images");

// Ensure image upload directory layout space exists natively
fs.ensureDirSync(UPLOAD_DIR);

// Explicitly serve static assets out of the upload folder across the /images route web space
app.use("/images", express.static(UPLOAD_DIR));

// Serve the static frontend (HTML/CSS/JS) from the project root so the app and API share
// one origin in local development. Block data and server files from being downloaded.
app.use((req, res, next) => {
  if (
    /(server\.js|users\.json|items\.json|logs\.json|visitors\.json|package(-lock)?\.json)$/.test(
      req.path,
    )
  ) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(__dirname));

// Storage Engine Config for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// Email configuration. Set EMAIL_USER / EMAIL_PASS (a Gmail App Password) in the environment
// to enable real delivery; otherwise emails are attempted with placeholders and simply logged.
const EMAIL_USER = process.env.EMAIL_USER || "your-email-address@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS || "your-app-password";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "gautam958@gmail.com";

// Startup diagnostic: prints whether the email credentials actually reached the process,
// WITHOUT exposing the password (only its length + a placeholder check). Read this in the
// Azure Log stream right after a restart to confirm the env vars are wired correctly.
const usingPlaceholderUser = EMAIL_USER === "your-email-address@gmail.com";
const usingPlaceholderPass = EMAIL_PASS === "your-app-password";
console.log(
  `Email config -> EMAIL_USER: ${EMAIL_USER} | EMAIL_PASS length: ${EMAIL_PASS.length} | ` +
    `OWNER_EMAIL: ${OWNER_EMAIL} | placeholder user: ${usingPlaceholderUser} | placeholder pass: ${usingPlaceholderPass}`,
);
if (usingPlaceholderUser || usingPlaceholderPass) {
  console.warn(
    "Email WILL FAIL: EMAIL_USER/EMAIL_PASS are not set in the environment (still using placeholders). " +
      "Set them in Azure → Web App → Settings → Environment variables, then Restart.",
  );
}

// Email Transporter Layer Initialization
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

// Verify SMTP credentials on boot so the Log stream shows immediately whether Gmail accepts them.
transporter.verify((err) => {
  if (err) {
    console.error("SMTP verify FAILED on startup:", err.message.split("\n")[0]);
  } else {
    console.log("SMTP verify OK on startup — Gmail accepted the credentials.");
  }
});

// ─── Google OAuth Configuration ─────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback";

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  console.log("Google OAuth credentials configured.");
} else {
  console.warn("Google OAuth NOT configured: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.");
}

// Passport initialization
app.use(passport.initialize());

// Configure Google OAuth Strategy
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Get existing users
          const users = await readData(USERS_FILE);
          
          // Check if user already exists with this Google ID
          let user = users.find((u) => u.googleId === profile.id);
          
          if (user) {
            // Update last login
            user.lastLogin = new Date().toISOString();
            await writeData(USERS_FILE, users);
            return done(null, user);
          }
          
          // Create new Google user
          const username = profile.displayName.replace(/\s+/g, "_").toLowerCase() + "_" + Date.now().toString(36);
          const newUser = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2),
            username: username,
            email: profile.emails?.[0]?.value || "",
            googleId: profile.id,
            googleEmail: profile.emails?.[0]?.value || "",
            googleName: profile.displayName,
            googlePicture: profile.photos?.[0]?.value || "",
            authProvider: "google",
            role: "user",
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
          };
          
          users.push(newUser);
          await writeData(USERS_FILE, users);
          
          return done(null, newUser);
        } catch (err) {
          console.error("Google OAuth error:", err);
          return done(err, null);
        }
      }
    )
  );

  // Serialize user for session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id, done) => {
    try {
      const users = await readData(USERS_FILE);
      const user = users.find((u) => u.id === id);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });
}

// Centralized mail sender. Never throws — logs failures so the request still succeeds even
// when SMTP credentials are placeholders or unreachable.
const sendMail = (mailOptions) => {
  const to = mailOptions.to || "";
  const subject = mailOptions.subject || "";
  transporter.sendMail(
    { from: `"Sello" <${EMAIL_USER}>`, ...mailOptions },
    (error, info) => {
      if (error) {
        // Capture the exact SMTP failure so admins can diagnose it from the Logs page.
        const parts = [
          `to: ${to}`,
          `subject: ${subject}`,
          error.code ? `code: ${error.code}` : "",
          error.responseCode ? `responseCode: ${error.responseCode}` : "",
          error.response ? `response: ${error.response}` : "",
          `error: ${error.message}`,
        ].filter(Boolean);
        console.error("SMTP delivery fault:", error.message);
        logActivity("email_failed", `Email NOT sent to ${to}`, {
          user: to,
          details: parts.join(" | "),
        });
      } else {
        console.log("Mail sent: " + info.response);
        logActivity("email_sent", `Email sent to ${to}`, {
          user: to,
          details: `subject: ${subject} | response: ${info.response}`,
        });
      }
    },
  );
};

// ─── Password hashing (scrypt, zero external dependencies) ─────
const hashPassword = (plain) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(plain), salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
};
const isHashed = (stored) =>
  typeof stored === "string" && stored.startsWith("scrypt$");
const verifyPassword = (plain, stored) => {
  if (!isHashed(stored)) return String(plain) === String(stored);
  const [, salt, hash] = stored.split("$");
  const derived = crypto.scryptSync(String(plain), salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(derived, "hex"),
  );
};

// ─── Reversible password encryption (AES-256-GCM) ───────────────
// Stored alongside the scrypt hash so the admin screen can display the real
// password. The key lives only on the server (env), never in users.json — so a
// leaked users.json file cannot be decrypted without it.
const ENC_KEY = crypto.scryptSync(
  process.env.PASSWORD_ENC_KEY ||
    process.env.AUTH_SECRET ||
    "sello-dev-secret-change-me",
  "sello-pw-enc",
  32,
);
const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `enc$${iv.toString("hex")}$${tag.toString("hex")}$${enc.toString("hex")}`;
};
const decryptSecret = (stored) => {
  try {
    if (!stored || !String(stored).startsWith("enc$")) return null;
    const [, ivh, tagh, dh] = stored.split("$");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      ENC_KEY,
      Buffer.from(ivh, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagh, "hex"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dh, "hex")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
};

// Store both the verification hash and the reversible encrypted copy.
const setUserPassword = (user, plain) => {
  user.password = hashPassword(plain);
  user.passwordEnc = encryptSecret(plain);
};

// Recover the real password for the admin screen (decrypt, or legacy plaintext).
const recoverPassword = (user) => {
  if (user.passwordEnc) return decryptSecret(user.passwordEnc) || "";
  if (!isHashed(user.password)) return user.password || ""; // legacy plaintext
  return ""; // hash-only, not recoverable
};

// ─── Token auth (HMAC-signed, stateless) ────────────────────────
const AUTH_SECRET = process.env.AUTH_SECRET || "sello-dev-secret-change-me";
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const signToken = (payload) => {
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: Date.now() }),
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
};

const verifyToken = (token) => {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(body)
    .digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (Date.now() - p.iat > TOKEN_MAX_AGE) return null;
    return p;
  } catch {
    return null;
  }
};

const authenticate = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload)
    return res.status(401).json({ message: "Authentication required." });
  req.auth = payload;
  next();
};

const requireAdmin = (req, res, next) => {
  authenticate(req, res, () => {
    if (req.auth.role !== "admin")
      return res.status(403).json({ message: "Admin privileges required." });
    next();
  });
};

// Helper validation reading functions
const readData = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const writeData = async (file, data) =>
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");

// ─── Activity logging (append-only JSON, capped) ────────────────
// Records user actions and server errors so admins can audit behaviour and
// spot potential bugs from the Logs screen. Never throws — logging must not
// break the request it is recording.
const LOG_LIMIT = 1000;
const logActivity = async (type, message, meta = {}) => {
  try {
    let logs = [];
    try {
      logs = await readData(LOGS_FILE);
      if (!Array.isArray(logs)) logs = [];
    } catch {
      logs = [];
    }
    logs.push({
      id: Date.now().toString() + Math.round(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      type, // signup | login | login_failed | bid | booking | user | item | error
      user: meta.user || "",
      message,
      details: meta.details || "",
    });
    if (logs.length > LOG_LIMIT) logs = logs.slice(logs.length - LOG_LIMIT);
    await writeData(LOGS_FILE, logs);
  } catch (e) {
    console.error("Activity log write failed:", e.message);
  }
};

// Look up a user's email address by username (returns undefined if not found).
const findUserEmail = (users, username) =>
  users.find((u) => u.username === username)?.email;

// ---------------- REST APIS ENDPOINTS ----------------

// USER REGISTRATION
app.post("/api/signup", async (req, res) => {
  const { username, email, password, mobile } = req.body;
  if (!mobile || !String(mobile).trim()) {
    return res.status(400).json({ message: "Mobile number is required." });
  }
  try {
    const users = await readData(USERS_FILE);
    if (users.find((u) => u.username === username)) {
      return res.status(400).json({ message: "Username already indexed." });
    }
    const newUser = {
      username,
      email,
      mobile,
      role: "user",
      createdAt: new Date().toISOString(),
    };
    setUserPassword(newUser, password);
    users.push(newUser);
    await writeData(USERS_FILE, users);

    await logActivity("signup", `New user registered: ${username}`, {
      user: username,
      details: `email: ${email || "—"}, mobile: ${mobile || "—"}`,
    });

    // Notify the owner that a new user has registered.
    sendMail({
      to: OWNER_EMAIL,
      subject: `Sello: New user registered — ${newUser.username}`,
      html: `
        <h2>New User Registration</h2>
        <p><strong>Username:</strong> ${newUser.username}</p>
        <p><strong>Email:</strong> ${newUser.email || "—"}</p>
        <p><strong>Mobile:</strong> ${newUser.mobile || "—"}</p>
        <p><strong>Role:</strong> ${newUser.role}</p>
        <p><strong>Registered:</strong> ${new Date(newUser.createdAt).toUTCString()}</p>
      `,
    });

    res.status(201).json({ message: "Account created successfully." });
  } catch (err) {
    await logActivity("error", `Signup failed: ${err.message}`, {
      user: req.body.username || "",
      details: "POST /api/signup",
    });
    res
      .status(500)
      .json({ message: "Error mapping signup persistence arrays." });
  }
});

// USER SIGN IN
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const users = await readData(USERS_FILE);
    const userIndex = users.findIndex((u) => u.username === username);

    if (
      userIndex === -1 ||
      !verifyPassword(password, users[userIndex].password)
    ) {
      await logActivity(
        "login_failed",
        `Failed login attempt for "${username}"`,
        {
          user: username || "",
          details: userIndex === -1 ? "unknown username" : "wrong password",
        },
      );
      return res
        .status(401)
        .json({ message: "Invalid operational credentials." });
    }

    // Upgrade legacy plaintext password to scrypt hash + encrypted copy on login
    if (!isHashed(users[userIndex].password) || !users[userIndex].passwordEnc) {
      setUserPassword(users[userIndex], password);
    }

    users[userIndex].lastLogin = new Date().toISOString();
    await writeData(USERS_FILE, users);

    const cleanUser = { ...users[userIndex] };
    delete cleanUser.password;
    delete cleanUser.passwordEnc;

    await logActivity("login", `${cleanUser.username} logged in`, {
      user: cleanUser.username,
      details: `role: ${cleanUser.role}`,
    });

    // Notify the owner that a user has logged in.
    sendMail({
      to: OWNER_EMAIL,
      subject: `Sello: ${cleanUser.username} just logged in`,
      html: `
        <h2>Login Activity</h2>
        <p><strong>User:</strong> ${cleanUser.username} (${cleanUser.role})</p>
        <p><strong>Email:</strong> ${cleanUser.email || "—"}</p>
        <p><strong>Time:</strong> ${new Date(cleanUser.lastLogin).toUTCString()}</p>
      `,
    });

    const token = signToken({
      username: cleanUser.username,
      role: cleanUser.role,
    });
    res.json({ message: "Authentication successful.", user: cleanUser, token });
  } catch (err) {
    await logActivity("error", `Login failed: ${err.message}`, {
      user: req.body.username || "",
      details: "POST /api/login",
    });
    res.status(500).json({ message: "Internal runtime server context error." });
  }
});

// ─── Google OAuth Routes ─────────────────────────────────────────────────────

// GET /auth/google - Initiate Google OAuth flow
app.get(
  "/auth/google",
  (req, res, next) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({ 
        message: "Google OAuth is not configured. Please contact the administrator." 
      });
    }
    
    // Store the return URL (default to index.html)
    const returnUrl = req.query.return || "index.html";
    req.session.oauthReturnUrl = returnUrl;
    
    passport.authenticate("google", {
      scope: ["profile", "email"],
      prompt: "select_account",
    })(req, res, next);
  }
);

// GET /auth/google/callback - Handle OAuth callback
app.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.redirect("/login.html?error=google_oauth_not_configured");
    }
    next();
  },
  passport.authenticate("google", { failureRedirect: "/login.html?error=google_auth_failed" }),
  async (req, res) => {
    try {
      if (!req.user) {
        return res.redirect("/login.html?error=google_auth_failed");
      }

      // Generate token for the user
      const cleanUser = { ...req.user };
      delete cleanUser.password;
      delete cleanUser.passwordEnc;

      const token = signToken({
        username: cleanUser.username,
        role: cleanUser.role,
        isGoogleUser: true,
      });

      // Log the login activity
      await logActivity("google_login", `${cleanUser.username} logged in with Google`, {
        user: cleanUser.username,
        details: `googleId: ${cleanUser.googleId}`,
      });

      // Get return URL from session or default to index.html
      const returnUrl = req.session.oauthReturnUrl || "index.html";
      delete req.session.oauthReturnUrl;

      // Notify owner
      sendMail({
        to: OWNER_EMAIL,
        subject: `Sello: ${cleanUser.username} logged in with Google`,
        html: `
          <h2>Google Login Activity</h2>
          <p><strong>User:</strong> ${cleanUser.username}</p>
          <p><strong>Email:</strong> ${cleanUser.googleEmail || "—"}</p>
          <p><strong>Google Name:</strong> ${cleanUser.googleName || "—"}</p>
          <p><strong>Time:</strong> ${new Date().toUTCString()}</p>
        `,
      });

      // Redirect with token (ensure absolute path)
      const safeReturnUrl = returnUrl.startsWith("/") ? returnUrl : `/${returnUrl}`;
      const separator = safeReturnUrl.includes("?") ? "&" : "?";
      res.redirect(`${safeReturnUrl}${separator}google_token=${token}&google_user=${encodeURIComponent(JSON.stringify(cleanUser))}`);
    } catch (err) {
      console.error("Google OAuth callback error:", err);
      res.redirect("/login.html?error=google_auth_error");
    }
  }
);

// ─── Forgot Password ───────────────────────────────────────────────────────

// In-memory store for reset codes (key: email, value: { code, expiresAt })
const resetCodes = new Map();

// Clean up expired codes every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, data] of resetCodes.entries()) {
    if (data.expiresAt < now) {
      resetCodes.delete(email);
    }
  }
}, 15 * 60 * 1000);

// POST /api/auth/forgot-password - Send reset code to email
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const users = await readData(USERS_FILE);
    const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({ message: "If that email exists, a reset code has been sent." });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store code
    resetCodes.set(email.toLowerCase(), { code, expiresAt });

    // Send email with code
    sendMail({
      to: email,
      subject: `[Sello] Password Reset Code`,
      text: `Your password reset code is: ${code}\n\nThis code is valid for 10 minutes. If you didn't request this, please ignore this email.\n\n- Sello Team`,
    });

    res.json({ message: "If that email exists, a reset code has been sent." });
  } catch (err) {
    res.status(500).json({ message: "Failed to process request." });
  }
});

// POST /api/auth/reset-password - Verify code and reset password
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: "Email, code, and new password are required." });
    }

    const stored = resetCodes.get(email.toLowerCase());
    if (!stored) {
      return res.status(400).json({ message: "Invalid or expired reset code. Please request a new one." });
    }

    if (stored.expiresAt < Date.now()) {
      resetCodes.delete(email.toLowerCase());
      return res.status(400).json({ message: "Reset code has expired. Please request a new one." });
    }

    if (stored.code !== code) {
      return res.status(400).json({ message: "Invalid reset code." });
    }

    // Code valid - update password
    const users = await readData(USERS_FILE);
    const userIndex = users.findIndex((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (userIndex === -1) {
      return res.status(404).json({ message: "User not found." });
    }

    // Update password (both hash and encrypted copy)
    setUserPassword(users[userIndex], newPassword);
    await writeData(USERS_FILE, users);

    // Invalidate the code
    resetCodes.delete(email.toLowerCase());

    // Log activity
    await logActivity("password_reset", `Password reset for: ${users[userIndex].username}`, {
      user: users[userIndex].username,
    });

    res.json({ message: "Password has been reset successfully. Please login with your new password." });
  } catch (err) {
    res.status(500).json({ message: "Failed to reset password." });
  }
});

// READ MARKETPLACE ITEMS (public — only enabled items, sensitive fields stripped)
app.get("/api/items", async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    const publicItems = items
      .filter((i) => i.enabled)
      .map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price: i.price,
        status: i.status,
        image: i.image,
        bidsCount: i.bids ? i.bids.length : 0,
        highestBid: i.highestBid || 0,
      }));
    res.json(publicItems);
  } catch (err) {
    res.status(500).json({ message: "Data fetch layer breakdown anomaly." });
  }
});

// PUBLIC: Get 5 recent bids across all items (for live activity panel)
// Shuffles all bids randomly so you see variety - sometimes multiple from same item
app.get("/api/recent-bids", async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    const recentBids = [];
    
    for (const item of items) {
      if (item.bids && item.bids.length > 0) {
        for (const bid of item.bids) {
          recentBids.push({
            itemId: item.id,
            itemName: item.name,
            itemImage: item.image,
            amount: bid.bidAmount,
            timestamp: bid.timestamp,
            itemStatus: item.status,
          });
        }
      }
    }
    
    // Shuffle bids randomly for variety (Fisher-Yates shuffle)
    for (let i = recentBids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [recentBids[i], recentBids[j]] = [recentBids[j], recentBids[i]];
    }
    
    // Take top 5 from shuffled array
    const topBids = recentBids.slice(0, 5);
    
    res.json(topBids);
  } catch (err) {
    res.status(500).json({ message: "Unable to fetch recent bids." });
  }
});

// MULTI-USER BIDDING / BOOKING ACTION ROUTE
app.post("/api/items/book/:id", authenticate, async (req, res) => {
  const itemId = req.params.id;
  const { bidAmount } = req.body;
  const user = req.auth.username;

  try {
    const items = await readData(ITEMS_FILE);
    const target = items.find((i) => i.id === itemId);

    if (!target)
      return res.status(404).json({ message: "Target item record missing." });
    if (!target.bids) target.bids = [];

    const parsedBid = parseFloat(bidAmount);
    const currentHighestBid =
      target.bids.length > 0
        ? Math.max(...target.bids.map((b) => b.bidAmount))
        : target.price;

    if (parsedBid < 0) {
      return res.status(400).json({
        message: `Bid must be a positive value.`,
      });
    }

    const newBidEntry = {
      userId: user,
      bidAmount: parsedBid,
      timestamp: new Date().toISOString(),
    };

    target.bids.push(newBidEntry);
    target.highestBid = parsedBid;

    await writeData(ITEMS_FILE, items);

    await logActivity("bid", `${user} placed a bid on "${target.name}"`, {
      user,
      details: `amount: HK$${parsedBid.toFixed(2)}`,
    });

    // Notify the owner of the new bid (high priority).
    sendMail({
      to: OWNER_EMAIL,
      subject: `🚨 HIGH PRIORITY: New High Bid Offer Registered [${target.name}]`,
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "high",
      },
      html: `
        <h2>Sello Marketplace Booking & Bidding Activity Log</h2>
        <hr/>
        <p><strong>Product Name:</strong> ${target.name}</p>
        <p><strong>Base Price Value:</strong> HK$${target.price}</p>
        <br/>
        <h3 style="color:#2563eb;">New Incoming Position Added:</h3>
        <p><strong>Associated Bidder:</strong> ${user}</p>
        <p><strong>Submitted Amount:</strong> <span style="font-size:1.2rem; color:#22c55e; font-weight:bold;">HK$${parsedBid.toFixed(2)}</span></p>
        <p><strong>Registration Timestamp:</strong> ${new Date(newBidEntry.timestamp).toUTCString()}</p>
      `,
    });

    // Also confirm the bid to the bidding user separately (if we have their email).
    const allUsers = await readData(USERS_FILE);
    const bidderEmail = findUserEmail(allUsers, user);
    if (bidderEmail) {
      sendMail({
        to: bidderEmail,
        subject: `Sello: Your bid on ${target.name} was received`,
        html: `
          <h2>Bid Confirmation</h2>
          <p>Hi ${user}, your bid has been registered successfully.</p>
          <p><strong>Product:</strong> ${target.name}</p>
          <p><strong>Your Bid:</strong> <span style="font-weight:bold; color:#16a34a;">HK$${parsedBid.toFixed(2)}</span></p>
          <p><strong>Time:</strong> ${new Date(newBidEntry.timestamp).toUTCString()}</p>
          <p>Pickup is from Tung Chung (Coastal Skyline) once the admin confirms. Pickup must be before 16-June-2026.</p>
        `,
      });
    }

    res.json({ message: "Bid accepted and written safely.", item: target });
  } catch (err) {
    await logActivity("error", `Bid failed: ${err.message}`, {
      user: req.body.user || "",
      details: `POST /api/items/book/${req.params.id}`,
    });
    res
      .status(500)
      .json({ message: "Error mapping bid collection structural entries." });
  }
});

// Notify the booked user (and the owner) that an item has been marked Booked for them.
const notifyBooking = async (item, bookedUser) => {
  if (!bookedUser) return;
  const users = await readData(USERS_FILE);
  const bookedEmail = findUserEmail(users, bookedUser);
  const detail = `
    <h2>Item Booked</h2>
    <p><strong>Product:</strong> ${item.name}</p>
    <p><strong>Price:</strong> HK$${parseFloat(item.highestBid).toFixed(2)}</p>
    <p><strong>Booked For:</strong> ${bookedUser}</p>
    <p>Pickup is from Tung Chung (Coastal Skyline, La Rossa B). 
       Detailed instructions will follow.<br/><br/>
       ⚠️ Pickup must be completed before <strong>16-June-2026</strong>.<br/>
  Please bring sufficient cash with you.<br/><br/>
  Confirm via Email / WhatsApp / Facebook within 2–4 hours, otherwise the booking will be cancelled and reopened.<br/>
  Include your preferred pickup time in your reply so we can arrange the schedule.<br/><br/>
  📞 For any help, call or WhatsApp: +852 53451910

       </p>
  `;
  sendMail({
    to: OWNER_EMAIL,
    subject: `Sello: ${item.name} booked for ${bookedUser}`,
    html: detail,
  });
  if (bookedEmail) {
    sendMail({
      to: bookedEmail,
      subject: `Sello: You have booked ${item.name}`,
      html: detail,
    });
  }
};

// Notify when item pickup is scheduled
const notifyPickupScheduled = async (item, bookedUser) => {
  if (!bookedUser) return;
  const users = await readData(USERS_FILE);
  const bookedEmail = findUserEmail(users, bookedUser);
  const detail = `
    <h2>Pickup Scheduled</h2>
    <p><strong>Product:</strong> ${item.name}</p>
    <p><strong>Price:</strong> HK$${parseFloat(item.highestBid).toFixed(2)}</p>
    <p>Your pickup has been scheduled for ${item.name}.</p>
    <p>Please bring sufficient cash and pickup before <strong>16-June-2026</strong>.<br/>
       Pickup location: Coastal Skyline, Tung Chung (La Rossa B)</p>
    <p>📞 For any help, call or WhatsApp: +852 53451910</p>
  `;
  sendMail({
    to: OWNER_EMAIL,
    subject: `Pickup scheduled: ${item.name} for ${bookedUser}`,
    html: detail,
  });
  if (bookedEmail) {
    sendMail({
      to: bookedEmail,
      subject: `Pickup scheduled for ${item.name}`,
      html: detail,
    });
  }
};

// Notify when item is sold
const notifySold = async (item, bookedUser) => {
  if (!bookedUser) return;
  const users = await readData(USERS_FILE);
  const bookedEmail = findUserEmail(users, bookedUser);
  const detail = `
    <h2>🎉 Item Sold!</h2>
    <p><strong>Product:</strong> ${item.name}</p>
    <p><strong>Final Price:</strong> HK$${parseFloat(item.highestBid).toFixed(2)}</p>
    <p>Congratulations! Your purchase of ${item.name} is complete.</p>
    <p>Please pickup from Coastal Skyline, Tung Chung before <strong>16-June-2026</strong>.</p>
    <p>📞 For any help, call or WhatsApp: +852 53451910</p>
  `;
  sendMail({
    to: OWNER_EMAIL,
    subject: `SOLD: ${item.name} to ${bookedUser}`,
    html: detail,
  });
  if (bookedEmail) {
    sendMail({
      to: bookedEmail,
      subject: `You purchased ${item.name} - Sold!`,
      html: detail,
    });
  }
};

// ADMIN: LIST ALL ITEMS (full data — bids, enabled flag, etc.)
app.get("/api/admin/items", requireAdmin, async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Data fetch layer breakdown anomaly." });
  }
});

// ADMIN: LIST ALL USERS
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await readData(USERS_FILE);
    res.json(
      users.map((u) => ({
        username: u.username,
        email: u.email || "",
        mobile: u.mobile || "",
        role: u.role,
        password: recoverPassword(u),
        createdAt: u.createdAt || "",
        lastLogin: u.lastLogin || "",
      })),
    );
  } catch (err) {
    res.status(500).json({ message: "Unable to read user directory." });
  }
});

// ADMIN: READ ACTIVITY LOGS (newest first, optional ?type= and ?limit= filters)
app.get("/api/admin/logs", requireAdmin, async (req, res) => {
  try {
    let logs = [];
    try {
      logs = await readData(LOGS_FILE);
      if (!Array.isArray(logs)) logs = [];
    } catch {
      logs = [];
    }
    logs = logs.slice().reverse(); // newest first
    if (req.query.type) logs = logs.filter((l) => l.type === req.query.type);
    const limit = parseInt(req.query.limit, 10);
    if (!isNaN(limit) && limit > 0) logs = logs.slice(0, limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: "Unable to read activity logs." });
  }
});

// ADMIN: CLEAR ACTIVITY LOGS
app.delete("/api/admin/logs", requireAdmin, async (req, res) => {
  try {
    await writeData(LOGS_FILE, []);
    await logActivity("log", "Activity logs cleared by admin", {
      user: req.auth.username,
    });
    res.json({ message: "Logs cleared." });
  } catch (err) {
    res.status(500).json({ message: "Unable to clear activity logs." });
  }
});

// ADMIN: CREATE USER
app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { username, email, mobile, role, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }
  try {
    const users = await readData(USERS_FILE);
    if (users.some((u) => u.username === username)) {
      return res.status(409).json({ message: "Username already exists." });
    }
    const newUser = {
      username,
      email: email || "",
      mobile: mobile || "",
      role: role === "admin" ? "admin" : "user",
      createdAt: new Date().toISOString(),
    };
    setUserPassword(newUser, password);
    users.push(newUser);
    await writeData(USERS_FILE, users);
    await logActivity("user", `Admin created user "${username}"`, {
      user: req.auth.username,
      details: `role: ${newUser.role}`,
    });
    const { password: _, passwordEnc: __, ...safe } = newUser;
    res.status(201).json(safe);
  } catch (err) {
    await logActivity("error", `Create user failed: ${err.message}`, {
      user: req.auth.username,
      details: "POST /api/admin/users",
    });
    res.status(500).json({ message: "Error creating user." });
  }
});

// ADMIN: UPDATE USER
app.put("/api/admin/users/:username", requireAdmin, async (req, res) => {
  const targetUsername = req.params.username;
  try {
    const users = await readData(USERS_FILE);
    const idx = users.findIndex((u) => u.username === targetUsername);
    if (idx === -1) return res.status(404).json({ message: "User not found." });

    const { email, mobile, role, password } = req.body;
    if (email !== undefined) users[idx].email = email;
    if (mobile !== undefined) users[idx].mobile = mobile;
    if (role !== undefined) users[idx].role = role;
    if (password && password.trim()) setUserPassword(users[idx], password);

    await writeData(USERS_FILE, users);
    await logActivity("user", `Admin updated user "${targetUsername}"`, {
      user: req.auth.username,
      details:
        password && password.trim() ? "password changed" : "profile updated",
    });
    const { password: _, passwordEnc: __, ...safe } = users[idx];
    res.json(safe);
  } catch (err) {
    await logActivity("error", `Update user failed: ${err.message}`, {
      user: req.auth.username,
      details: `PUT /api/admin/users/${targetUsername}`,
    });
    res.status(500).json({ message: "Error updating user." });
  }
});

// ADMIN: DELETE USER
app.delete("/api/admin/users/:username", requireAdmin, async (req, res) => {
  const targetUsername = req.params.username;
  if (targetUsername === req.auth.username) {
    return res.status(400).json({ message: "Cannot delete your own account." });
  }
  try {
    let users = await readData(USERS_FILE);
    const existed = users.some((u) => u.username === targetUsername);
    if (!existed) return res.status(404).json({ message: "User not found." });
    users = users.filter((u) => u.username !== targetUsername);
    await writeData(USERS_FILE, users);
    await logActivity("user", `Admin deleted user "${targetUsername}"`, {
      user: req.auth.username,
    });
    res.json({ message: "User deleted." });
  } catch (err) {
    await logActivity("error", `Delete user failed: ${err.message}`, {
      user: req.auth.username,
      details: `DELETE /api/admin/users/${targetUsername}`,
    });
    res.status(500).json({ message: "Error deleting user." });
  }
});

// ADMIN: CREATE PRODUCT
app.post(
  "/api/admin/items",
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const items = await readData(ITEMS_FILE);
      const status = req.body.status || "Available";
      const bookedUser = (status === "Booked" || status === "Pickup Scheduled" || status === "Sold") ? req.body.bookedUser || "" : "";
      const newItem = {
        id: Date.now().toString(),
        name: req.body.name,
        description: req.body.description,
        price: parseFloat(req.body.price),
        status,
        bookedUser,
        // Storing ONLY the raw filename to isolate file storage paths out of data rows
        image: req.file ? req.file.filename : "default.jpg",
        enabled: req.body.enabled === "true",
        bids: [],
        highestBid: 0,
      };

      items.push(newItem);
      await writeData(ITEMS_FILE, items);
      await logActivity("item", `Admin created item "${newItem.name}"`, {
        user: req.auth.username,
        details: `status: ${status}, price: HK$${newItem.price}`,
      });
      if (status === "Booked") {
        await notifyBooking(newItem, bookedUser);
        await logActivity(
          "booking",
          `"${newItem.name}" booked for ${bookedUser}`,
          {
            user: req.auth.username,
            details: `booked user: ${bookedUser}`,
          },
        );
      }
      res.status(201).json(newItem);
    } catch (err) {
      await logActivity("error", `Create item failed: ${err.message}`, {
        user: req.auth.username,
        details: "POST /api/admin/items",
      });
      res.status(500).json({
        message: "Failure appending new product configuration parameters.",
      });
    }
  },
);

// ADMIN: UPDATE PRODUCT
app.put(
  "/api/admin/items/:id",
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    const id = req.params.id;
    try {
      const items = await readData(ITEMS_FILE);
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1)
        return res.status(404).json({ message: "Item profile missing." });

      const status = req.body.status || "Available";
      const bookedUser = (status === "Booked" || status === "Pickup Scheduled" || status === "Sold") ? req.body.bookedUser || "" : "";
      const updatedFields = {
        name: req.body.name,
        description: req.body.description,
        price: parseFloat(req.body.price),
        enabled: req.body.enabled === "true",
        status,
        bookedUser,
      };

      if (req.file) {
        const legacyImage = items[idx].image;
        if (legacyImage && legacyImage !== "default.jpg") {
          const filename = legacyImage.includes("/")
            ? legacyImage.split("/").pop()
            : legacyImage;
          await fs.remove(path.join(UPLOAD_DIR, filename)).catch(() => {});
        }
        updatedFields.image = req.file.filename;
      }

      // Detect a transition into a Booked state (or a change of booked user) to email.
      const previous = items[idx];
      const becameBooked =
        status === "Booked" &&
        (previous.status !== "Booked" || previous.bookedUser !== bookedUser);

      // Detect status transitions for notifications
      const becamePickupScheduled = 
        status === "Pickup Scheduled" && 
        previous.status !== "Pickup Scheduled" && 
        bookedUser;
      const becameSold = 
        status === "Sold" && 
        previous.status !== "Sold" && 
        bookedUser;

      items[idx] = { ...items[idx], ...updatedFields };
      await writeData(ITEMS_FILE, items);
      await logActivity("item", `Admin updated item "${items[idx].name}"`, {
        user: req.auth.username,
        details: `status: ${status}`,
      });
      if (becameBooked) {
        await notifyBooking(items[idx], bookedUser);
        await logActivity(
          "booking",
          `"${items[idx].name}" booked for ${bookedUser}`,
          {
            user: req.auth.username,
            details: `booked user: ${bookedUser}`,
          },
        );
      }
      if (becamePickupScheduled) {
        await notifyPickupScheduled(items[idx], bookedUser);
        await logActivity("pickup_scheduled", `"${items[idx].name}" pickup scheduled for ${bookedUser}`, {
          user: req.auth.username,
        });
      }
      if (becameSold) {
        await notifySold(items[idx], bookedUser);
        await logActivity("sold", `"${items[idx].name}" sold to ${bookedUser}`, {
          user: req.auth.username,
        });
      }
      res.json(items[idx]);
    } catch (error) {
      await logActivity("error", `Update item failed: ${error.message}`, {
        user: req.auth.username,
        details: `PUT /api/admin/items/${id}`,
      });
      res.status(500).json({ message: "Mutation context execution error." });
    }
  },
);

// ADMIN: REMOVE PRODUCT
app.delete("/api/admin/items/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    let items = await readData(ITEMS_FILE);
    const targetItem = items.find((i) => i.id === id);

    if (targetItem && targetItem.image && targetItem.image !== "default.jpg") {
      const filename = targetItem.image.includes("/")
        ? targetItem.image.split("/").pop()
        : targetItem.image;
      await fs.remove(path.join(UPLOAD_DIR, filename)).catch(() => {});
    }

    const removedName = targetItem ? targetItem.name : id;
    items = items.filter((i) => i.id !== id);
    await writeData(ITEMS_FILE, items);
    await logActivity("item", `Admin deleted item "${removedName}"`, {
      user: req.auth.username,
    });
    res.json({ message: "Item Removed Successfully." });
  } catch (err) {
    await logActivity("error", `Delete item failed: ${err.message}`, {
      user: req.auth.username,
      details: `DELETE /api/admin/items/${id}`,
    });
    res.status(500).json({ message: "Drop tracking mapping indices fault." });
  }
});

// ─── Visitor analytics ──────────────────────────────────────────
// Lightweight, no-database visitor tracking. The client sends a stable
// `visitorId` (generated and persisted in localStorage) on every page load.
// The server looks up the visitor's approximate location from their IP using
// ipapi.co (free, no key), caches it for 24h, and appends/updates a record
// in visitors.json. IPs are stored as a SHA-256 hash, never in plain form.

const GEO_CACHE = new Map(); // ip -> { geo, ts }
const GEO_TTL_MS = 24 * 60 * 60 * 1000;

const hashIp = (ip) =>
  crypto
    .createHash("sha256")
    .update(String(ip || ""))
    .digest("hex")
    .slice(0, 16);

const getClientIp = (req) => {
  // Check various headers that proxies/CDNs/load balancers set
  const headers = [
    req.headers["x-client-ip"],
    req.headers["x-forwarded-for"],
    req.headers["x-real-ip"],
    req.headers["cf-connecting-ip"], // Cloudflare
    req.headers["x-azure-clientip"], // Azure App Service
    req.ip,
  ];
  
  for (const h of headers) {
    if (h) {
      const ip = String(h).split(",")[0].trim().replace(/^::ffff:/, "");
      if (ip && ip !== "127.0.0.1" && ip !== "::1") {
        return ip;
      }
    }
  }
  return req.ip || "";
};

// Fallback external IP service when behind proxy
const fetchExternalIp = async () => {
  const services = [
    "https://api.ipify.org",
    "https://icanhazip.com",
    "https://checkip.amazonaws.com",
  ];
  for (const url of services) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const text = await resp.text();
        const ip = text.trim().replace(/^::ffff:/, "");
        if (ip && !isPrivateIp(ip)) return ip;
      }
    } catch {}
  }
  return "";
};

const isPrivateIp = (ip) =>
  !ip ||
  ip === "127.0.0.1" ||
  ip === "::1" ||
  /^10\./.test(ip) ||
  /^192\.168\./.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

const lookupGeo = async (ip) => {
  // If IP is private, try to get external IP as fallback
  if (isPrivateIp(ip)) {
    ip = await fetchExternalIp();
    if (!ip) return { country: "", city: "", region: "", timezone: "" };
  }
  const cached = GEO_CACHE.get(ip);
  if (cached && Date.now() - cached.ts < GEO_TTL_MS) return cached.geo;
  try {
    const resp = await fetch(
      `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
      {
        headers: { "User-Agent": "sello-visitor-tracker/1.0" },
      },
    );
    if (!resp.ok) throw new Error(`ipapi ${resp.status}`);
    const data = await resp.json();
    const geo = {
      country: data.country_name || data.country || "",
      countryCode: data.country_code || "",
      city: data.city || "",
      region: data.region || "",
      timezone: data.timezone || "",
    };
    GEO_CACHE.set(ip, { geo, ts: Date.now() });
    return geo;
  } catch (e) {
    return { country: "", city: "", region: "", timezone: "" };
  }
};

const parseUA = (ua = "") => {
  const s = String(ua);
  let browser = "Other";
  if (/Edg\//.test(s)) browser = "Edge";
  else if (/OPR\//.test(s)) browser = "Opera";
  else if (/Chrome\//.test(s)) browser = "Chrome";
  else if (/Safari\//.test(s) && !/Chrome\//.test(s)) browser = "Safari";
  else if (/Firefox\//.test(s)) browser = "Firefox";
  let os = "Other";
  if (/Windows/.test(s)) os = "Windows";
  else if (/Android/.test(s)) os = "Android";
  else if (/iPhone|iPad|iOS/.test(s)) os = "iOS";
  else if (/Mac OS X/.test(s)) os = "macOS";
  else if (/Linux/.test(s)) os = "Linux";
  const device = /Mobi|Android|iPhone/.test(s)
    ? "Mobile"
    : /iPad|Tablet/.test(s)
      ? "Tablet"
      : "Desktop";
  return { browser, os, device };
};

// PUBLIC: record a page visit. Called by the frontend on every page load.
// Body: { visitorId, path, referrer, computerName }
app.post("/api/track", async (req, res) => {
  try {
    const { visitorId, path: visitedPath, referrer, computerName } = req.body || {};
    if (!visitorId || typeof visitorId !== "string" || visitorId.length > 64) {
      return res.status(400).json({ message: "Invalid visitorId." });
    }

    const ip = getClientIp(req);
    const ipHash = hashIp(ip);
    const ua = req.headers["user-agent"] || "";
    const { browser, os, device } = parseUA(ua);
    const now = new Date().toISOString();

    // Link to a logged-in user if a valid token is present.
    let authedUser = "";
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (payload && payload.username) authedUser = payload.username;

    let visitors = [];
    try {
      visitors = await readData(VISITORS_FILE);
      if (!Array.isArray(visitors)) visitors = [];
    } catch {
      visitors = [];
    }

    const idx = visitors.findIndex((v) => v.visitorId === visitorId);
    const SESSION_GAP_MS = 30 * 60 * 1000;

    if (idx === -1) {
      // New visitor — look up geo (only on first sight, cached after).
      const geo = await lookupGeo(ip);
      visitors.push({
        visitorId,
        firstSeen: now,
        lastSeen: now,
        pageViews: 1,
        visitCount: 1,
        lastPath: visitedPath || "",
        landingPath: visitedPath || "",
        referrer: referrer || "",
        user: authedUser || "",
        ipHash,
        browser,
        os,
        device,
        userAgent: ua.slice(0, 240),
        country: geo.country,
        countryCode: geo.countryCode,
        city: geo.city,
        region: geo.region,
        timezone: geo.timezone,
        computerName: computerName || "",
        isNew: true,
      });
    } else {
      const v = visitors[idx];
      const gap = Date.now() - new Date(v.lastSeen).getTime();
      v.lastSeen = now;
      v.pageViews = (v.pageViews || 0) + 1;
      if (gap > SESSION_GAP_MS) v.visitCount = (v.visitCount || 1) + 1;
      v.lastPath = visitedPath || v.lastPath;
      if (authedUser && !v.user) v.user = authedUser;
      v.browser = browser;
      v.os = os;
      v.device = device;
      v.ipHash = ipHash;
      v.isNew = false;
      if (computerName) v.computerName = computerName;
      // Backfill geo if we missed it the first time.
      if (!v.country) {
        const geo = await lookupGeo(ip);
        v.country = geo.country;
        v.countryCode = geo.countryCode;
        v.city = geo.city;
        v.region = geo.region;
        v.timezone = geo.timezone;
      }
    }

    // Cap stored visitors at 5000 (drop oldest by firstSeen).
    if (visitors.length > 5000) {
      visitors.sort((a, b) => new Date(a.firstSeen) - new Date(b.firstSeen));
      visitors = visitors.slice(-5000);
    }

    await writeData(VISITORS_FILE, visitors);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Track failed." });
  }
});

// ADMIN: list all visitors (newest activity first).
app.get("/api/admin/visitors", requireAdmin, async (req, res) => {
  try {
    let visitors = [];
    try {
      visitors = await readData(VISITORS_FILE);
      if (!Array.isArray(visitors)) visitors = [];
    } catch {
      visitors = [];
    }
    visitors.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    res.json(visitors);
  } catch (err) {
    res.status(500).json({ message: "Unable to read visitor records." });
  }
});

// ADMIN: clear all visitors.
app.delete("/api/admin/visitors", requireAdmin, async (req, res) => {
  try {
    await writeData(VISITORS_FILE, []);
    res.json({ message: "Visitors cleared." });
  } catch (err) {
    res.status(500).json({ message: "Failed to clear visitors." });
  }
});

// ─── Wishlist ───────────────────────────────────────────────────────────────

// Get user's wishlist (auth required)
app.get("/api/wishlist", authenticate, async (req, res) => {
  try {
    const wishlist = await readData(WISHLIST_FILE);
    const userWishlist = wishlist.filter((w) => w.userId === req.auth.username);
    res.json(userWishlist);
  } catch (err) {
    res.status(500).json({ message: "Unable to fetch wishlist." });
  }
});

// Add item to wishlist (auth required)
app.post("/api/wishlist", authenticate, async (req, res) => {
  try {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ message: "Item ID required." });

    const items = await readData(ITEMS_FILE);
    const item = items.find((i) => i.id === itemId);
    if (!item) return res.status(404).json({ message: "Item not found." });

    const wishlist = await readData(WISHLIST_FILE);
    
    // Check if already wishlisted
    const existing = wishlist.find(
      (w) => w.userId === req.auth.username && w.itemId === itemId,
    );
    if (existing) {
      return res.status(400).json({ message: "Item already in wishlist." });
    }

    // Get user details
    const users = await readData(USERS_FILE);
    const user = users.find((u) => u.username === req.auth.username);

    wishlist.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      userId: req.auth.username,
      userEmail: user?.email || "",
      userMobile: user?.mobile || "",
      itemId: item.id,
      itemName: item.name,
      itemPrice: item.price,
      itemImage: item.image,
      addedAt: new Date().toISOString(),
    });

    await writeData(WISHLIST_FILE, wishlist);
    res.json({ message: "Added to wishlist." });
  } catch (err) {
    res.status(500).json({ message: "Failed to add to wishlist." });
  }
});

// Remove item from wishlist (auth required)
app.delete("/api/wishlist/:itemId", authenticate, async (req, res) => {
  try {
    const wishlist = await readData(WISHLIST_FILE);
    const filtered = wishlist.filter(
      (w) =>
        !(w.userId === req.auth.username && w.itemId === req.params.itemId),
    );
    await writeData(WISHLIST_FILE, filtered);
    res.json({ message: "Removed from wishlist." });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove from wishlist." });
  }
});

// ADMIN: Get all wishlists
app.get("/api/admin/wishlist", requireAdmin, async (req, res) => {
  try {
    const wishlist = await readData(WISHLIST_FILE);
    // Sort by addedAt descending
    wishlist.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    res.json(wishlist);
  } catch (err) {
    res.status(500).json({ message: "Unable to fetch wishlists." });
  }
});

// ADMIN: Send inquiry email to wishlist user
app.post("/api/admin/wishlist/contact", requireAdmin, async (req, res) => {
  try {
    const { wishlistId, message } = req.body;
    if (!wishlistId || !message) {
      return res.status(400).json({ message: "Wishlist ID and message required." });
    }

    const wishlist = await readData(WISHLIST_FILE);
    const entry = wishlist.find((w) => w.id === wishlistId);
    if (!entry) return res.status(404).json({ message: "Wishlist entry not found." });

    const items = await readData(ITEMS_FILE);
    const item = items.find((i) => i.id === entry.itemId);
    
    const itemPrice = item ? item.price : entry.itemPrice;
    const itemBids = item?.bids?.length || 0;
    const itemHighest = item?.highestBid || 0;

    const emailBody = `Hi ${entry.userId},

You have "${entry.itemName}" on your wishlist from Sello.

📦 Item Details:
   • Current Price: HK$ ${itemPrice}
   • Status: ${item?.status || "N/A"}
   • Highest Bid: HK$ ${itemHighest} (${itemBids} bids)
   • Pickup Location: Coastal Skyline, Tung Chung

💬 Message from Admin:
${message}

---
Best regards,
Sello Team`;

    sendMail({
      to: entry.userEmail,
      cc: OWNER_EMAIL,
      subject: `Inquiry about your wishlisted item: ${entry.itemName}`,
      text: emailBody,
    });

    // Update wishlist entry with email sent timestamp
    entry.emailSentAt = new Date().toISOString();
    await writeData(WISHLIST_FILE, wishlist);

    res.json({ message: "Email sent successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to send email." });
  }
});

// ADMIN: Delete wishlist entry
app.delete("/api/admin/wishlist/:id", requireAdmin, async (req, res) => {
  try {
    const wishlist = await readData(WISHLIST_FILE);
    const filtered = wishlist.filter((w) => w.id !== req.params.id);
    await writeData(WISHLIST_FILE, filtered);
    res.json({ message: "Wishlist entry deleted." });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete entry." });
  }
});

// PUBLIC: Contact form - send email to owner
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const emailBody = `New Contact Form Submission

From: ${name}
Email: ${email}
Subject: ${subject}

Message:
${message}

---
Sent from Sello Marketplace Contact Form`;

    sendMail({
      to: OWNER_EMAIL,
      subject: `[Sello Contact] ${subject}`,
      text: emailBody,
    });

    res.json({ message: "Message sent successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Failed to send message." });
  }
});

// Forward standard root routing to check status
app.get("/", (req, res) =>
  res.send(
    "Sello Dynamic Host Engine Operational. Use API endpoints to exchange resources.",
  ),
);

// One-time migration: secure any legacy plaintext passwords (hash + encrypt)
// while keeping them recoverable for the admin screen.
const migratePasswords = async () => {
  try {
    const users = await readData(USERS_FILE);
    let changed = false;
    for (const u of users) {
      if (u.password && !isHashed(u.password)) {
        if (!u.passwordEnc) u.passwordEnc = encryptSecret(u.password);
        u.password = hashPassword(u.password);
        changed = true;
      } else if (isHashed(u.password) && !u.passwordEnc) {
        // hash-only legacy user: password not recoverable, leave as-is
      }
    }
    if (changed) {
      await writeData(USERS_FILE, users);
      console.log(
        "🔐 Migrated legacy plaintext passwords to hash + encrypted.",
      );
    }
  } catch (e) {
    console.error("Password migration skipped:", e.message);
  }
};
migratePasswords();

app.listen(PORT, () => {
  console.log(
    `🚀 Sello Unified Engine actively online at path address: http://localhost:${PORT}`,
  );
});
