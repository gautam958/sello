const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS to accept requests from your production frontend site
app.use(
  cors({
    origin: "https://gautam958.github.io",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

app.use(express.json());

// Path Definitions - Lowercase folder matching production standard environments
const USERS_FILE = path.join(__dirname, "users.json");
const ITEMS_FILE = path.join(__dirname, "items.json");
const UPLOAD_DIR = path.join(__dirname, "images");

// Ensure image upload directory layout space exists natively
fs.ensureDirSync(UPLOAD_DIR);

// Explicitly serve static assets out of the upload folder across the /images route web space
app.use("/images", express.static(UPLOAD_DIR));

// Serve the static frontend (HTML/CSS/JS) from the project root so the app and API share
// one origin in local development. Block data and server files from being downloaded.
app.use((req, res, next) => {
  if (
    /(server\.js|users\.json|items\.json|package(-lock)?\.json)$/.test(req.path)
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
const EMAIL_USER = process.env.EMAIL_USER || "gautam958@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS || "sqvo muzr huds onqi";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "gautam958@gmail.com";

// Email Transporter Layer Initialization
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

// Centralized mail sender. Never throws — logs failures so the request still succeeds even
// when SMTP credentials are placeholders or unreachable.
const sendMail = (mailOptions) => {
  transporter.sendMail(
    { from: `"Sello" <${EMAIL_USER}>`, ...mailOptions },
    (error, info) => {
      if (error) console.error("SMTP delivery fault:", error.message);
      else console.log("Mail sent: " + info.response);
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
    res.status(500).json({ message: "Internal runtime server context error." });
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

// MULTI-USER BIDDING / BOOKING ACTION ROUTE
app.post("/api/items/book/:id", async (req, res) => {
  const itemId = req.params.id;
  const { user, bidAmount } = req.body;

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
        <h2>Marketplace Booking & Bidding Activity Log</h2>
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
    <p><strong>Price:</strong> HK$${parseFloat(item.price).toFixed(2)}</p>
    <p><strong>Booked For:</strong> ${bookedUser}</p>
    <p>Pickup is from Tung Chung (Coastal Skyline). Detailed instructions will follow.
       Pickup must be before 16-June-2026.</p>
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
    const { password: _, passwordEnc: __, ...safe } = newUser;
    res.status(201).json(safe);
  } catch (err) {
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
    const { password: _, passwordEnc: __, ...safe } = users[idx];
    res.json(safe);
  } catch (err) {
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
    res.json({ message: "User deleted." });
  } catch (err) {
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
      const status = req.body.status === "Booked" ? "Booked" : "Available";
      const bookedUser = status === "Booked" ? req.body.bookedUser || "" : "";
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
      if (status === "Booked") await notifyBooking(newItem, bookedUser);
      res.status(201).json(newItem);
    } catch (err) {
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

      const status = req.body.status === "Booked" ? "Booked" : "Available";
      const bookedUser = status === "Booked" ? req.body.bookedUser || "" : "";
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

      items[idx] = { ...items[idx], ...updatedFields };
      await writeData(ITEMS_FILE, items);
      if (becameBooked) await notifyBooking(items[idx], bookedUser);
      res.json(items[idx]);
    } catch (error) {
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

    items = items.filter((i) => i.id !== id);
    await writeData(ITEMS_FILE, items);
    res.json({ message: "Item Removed Successfully." });
  } catch (err) {
    res.status(500).json({ message: "Drop tracking mapping indices fault." });
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
