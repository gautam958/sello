const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: "https://gautam958.github.io",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

app.use(express.json());

const USERS_FILE = path.join(__dirname, "users.json");
const ITEMS_FILE = path.join(__dirname, "items.json");
const UPLOAD_DIR = path.join(__dirname, "Images");

fs.ensureDirSync(UPLOAD_DIR);

app.use("/Images", express.static(UPLOAD_DIR));

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

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "your-email-address@gmail.com",
    pass: "your-app-password",
  },
});

const readData = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const writeData = async (file, data) =>
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");

// USER REGISTRATION
app.post("/api/signup", async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const users = await readData(USERS_FILE);
    if (users.find((u) => u.username === username)) {
      return res.status(400).json({ message: "Username already indexed." });
    }
    const newUser = {
      username,
      email,
      password,
      role: "user",
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    await writeData(USERS_FILE, users);
    res.status(201).json({ message: "Account created successfully." });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error mapping signup persistence arrays." });
  }
});

// USER SIGN IN WITH LIVE EMAIL TELEMETRY
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const users = await readData(USERS_FILE);
    const userIndex = users.findIndex(
      (u) => u.username === username && u.password === password,
    );

    if (userIndex === -1) {
      return res
        .status(401)
        .json({ message: "Invalid operational credentials." });
    }

    const timestamp = new Date().toISOString();
    users[userIndex].lastLogin = timestamp;
    await writeData(USERS_FILE, users);

    const cleanUser = { ...users[userIndex] };
    delete cleanUser.password;

    const loginMailOptions = {
      from: '"Sello Security Operations" <your-email-address@gmail.com>',
      to: "gautam958@gmail.com",
      subject: `🛡️ Security Alert: User Login Tracked [${cleanUser.username}]`,
      html: `
        <div style="font-family: sans-serif; padding: 1rem; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1e3a8a; margin-top: 0;">Sello System Access Log</h2>
          <hr style="border: 0; border-top: 1px solid #e2e8f0;" />
          <p>An authentication request has successfully cleared the application firewall.</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 1rem;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 130px;"><strong>Username:</strong></td>
              <td style="padding: 6px 0; color: #1e293b;">${cleanUser.username}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Assigned Role:</strong></td>
              <td style="padding: 6px 0; color: #1e293b;"><span style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem;">${cleanUser.role}</span></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Email Registered:</strong></td>
              <td style="padding: 6px 0; color: #1e293b;">${cleanUser.email || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;"><strong>Timestamp:</strong></td>
              <td style="padding: 6px 0; color: #1e293b;">${new Date(timestamp).toUTCString()}</td>
            </tr>
          </table>
        </div>
      `,
    };

    transporter.sendMail(loginMailOptions, () => {});

    res.json({ message: "Authentication successful.", user: cleanUser });
  } catch (err) {
    res.status(500).json({ message: "Internal runtime server context error." });
  }
});

// READ MARKETPLACE ITEMS
app.get("/api/items", async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    res.json(items);
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

    if (parsedBid < currentHighestBid) {
      return res.status(400).json({
        message: `Bid must equal or exceed current high valuation of $${currentHighestBid}`,
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

    const mailOptions = {
      from: '"Sello Competitive Engine" <your-email-address@gmail.com>',
      to: "gautam958@gmail.com",
      subject: `🚨 New High Bid Offer Registered [${target.name}]`,
      html: `<h3>New Incoming Position Added:</h3><p><strong>Bidder:</strong> ${user}</p><p><strong>Amount:</strong> $${parsedBid.toFixed(2)}</p>`,
    };

    transporter.sendMail(mailOptions, () => {});

    res.json({ message: "Bid accepted and written safely.", item: target });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error mapping bid collection structural entries." });
  }
});

// ADMIN: CREATE PRODUCT
app.post("/api/admin/items", upload.single("Image"), async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    const newItem = {
      id: Date.now().toString(),
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      status: req.body.status || "Available", // RESTORED
      image: req.file ? req.file.filename : "default.jpg",
      enabled: req.body.enabled === "true",
      bids: [],
      highestBid: 0,
    };

    items.push(newItem);
    await writeData(ITEMS_FILE, items);
    res.status(201).json(newItem);
  } catch (err) {
    res.status(500).json({
      message: "Failure appending new product configuration parameters.",
    });
  }
});

// ADMIN: UPDATE PRODUCT
app.put("/api/admin/items/:id", upload.single("Image"), async (req, res) => {
  const id = req.params.id;
  try {
    const items = await readData(ITEMS_FILE);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1)
      return res.status(404).json({ message: "Item profile missing." });

    const updatedFields = {
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      status: req.body.status, // RESTORED
      enabled: req.body.enabled === "true",
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

    items[idx] = { ...items[idx], ...updatedFields };
    await writeData(ITEMS_FILE, items);
    res.json(items[idx]);
  } catch (error) {
    res.status(500).json({ message: "Mutation context execution error." });
  }
});

// ADMIN: REMOVE PRODUCT
app.delete("/api/admin/items/:id", async (req, res) => {
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

app.get("/", (req, res) => res.send("Sello Engine Online."));

app.listen(PORT, () => {
  console.log(`🚀 Sello online at path address: http://localhost:${PORT}`);
});
