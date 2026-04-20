require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');
const vault = require('node-vault');

const app = express();
const port = process.env.PORT || 3000;

const vaultClient = vault({
  apiVersion: 'v1',
  endpoint: process.env.VAULT_ADDR || 'http://localhost:8080',
  token: process.env.VAULT_TOKEN
});

let secrets = {};
let pool;

async function fetchSecrets() {
  try {
    const secretPath = process.env.VAULT_SECRET_PATH || 'secret/data/myapp/config';
    const result = await vaultClient.read(secretPath);
    secrets = result.data.data || {};
    console.log('Secrets loaded from OpenBao');
  } catch (err) {
    console.error('Failed to fetch secrets from OpenBao:', err.message);
    console.log('Falling back to environment variables');
    secrets = {
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_NAME: process.env.DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      JWT_SECRET: process.env.JWT_SECRET
    };
  }
}

function createPool() {
  return new Pool({
    host: secrets.DB_HOST || process.env.DB_HOST || 'localhost',
    port: secrets.DB_PORT || process.env.DB_PORT || 5432,
    database: secrets.DB_NAME || process.env.DB_NAME || 'authdb',
    user: secrets.DB_USER || process.env.DB_USER || 'postgres',
    password: secrets.DB_PASSWORD || process.env.DB_PASSWORD || 'postgres'
  });
}

async function connectToDatabase(retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT NOW()');
      console.log('Database connected successfully');
      return true;
    } catch (err) {
      console.log(`Database connection attempt ${i + 1}/${retries} failed. Retrying in 3s...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw new Error('Failed to connect to database after maximum retries');
}

async function initDatabase() {
  try {
    await connectToDatabase();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database initialized');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
  }
}

async function initializeApp() {
  await fetchSecrets();
  pool = createPool();
  console.log('DB Config:', {
    host: pool.options.host,
    port: pool.options.port,
    database: pool.options.database,
    user: pool.options.user
  });
  await initDatabase();
}

function getJwtSecret() {
  return secrets.JWT_SECRET || process.env.JWT_SECRET || 'your-secret-key';
}

app.use(express.json());
app.use(express.static('public'));

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword]
    );
    res.status(201).json({ message: 'User registered successfully', user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    res.json({ message: 'Login successful', token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT id, username, email, created_at FROM users WHERE id = $1', [req.user.userId]);
    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    const statsResult = await pool.query('SELECT COUNT(*) as total_users FROM users');
    const totalUsers = parseInt(statsResult.rows[0].total_users);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        registeredAt: user.created_at
      },
      stats: {
        totalUsers
      },
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as db_time, version() as db_version');
    res.json({ status: 'connected', db: 'PostgreSQL', ...result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'disconnected', error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

initializeApp().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
});
