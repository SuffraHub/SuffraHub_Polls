const express = require('express')
const app = express()
const port = 8001

const cors = require('cors');

require('dotenv').config();
const mysql = require('mysql');

app.use(cors());
app.use(express.json());

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

connection.connect(err => {
  if (err) {
    console.error('DB connection error:', err.stack);
    return;
  }
  console.log('Connected to MySQL');
});

app.get('/poll-by-code/:token', (req, res) => {
  const { token } = req.params;

  connection.query(
    'SELECT poll_id FROM vote_tokens WHERE token = ?',
    [token],
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Poll not found' });
      }

      res.json({ poll_id: results[0].poll_id });
    }
  );
});

app.post('/createPoll', (req, res) => {
  const { name, description, is_active, owner_id, company_id, valid_to } = req.body;

  if (!name || !description || is_active === undefined || !owner_id || !company_id || !valid_to) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const query = `
        INSERT INTO polls (name, description, is_active, owner_id, company_id, valid_to)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

  connection.query(query, [name, description, is_active, owner_id, company_id, valid_to], (err, result) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ message: 'Poll creation failed' });
    }

    return res.status(201).json({ message: 'Poll created successfully', pollId: result.insertId });
  });
});

app.post('/editPoll', (req, res) => {
  const { pollId, name, description, is_active, owner_id, company_id, valid_to } = req.body;

  // Walidacja
  if (
    !pollId ||
    !name ||
    !description ||
    is_active === undefined ||
    !owner_id ||
    !company_id ||
    !valid_to
  ) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const query = `
    UPDATE polls
    SET name = ?, description = ?, is_active = ?, owner_id = ?, company_id = ?, valid_to = ?
    WHERE id = ?
  `;

  const values = [name, description, is_active, owner_id, company_id, valid_to, pollId];

  connection.query(query, values, (err, result) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ message: 'Poll update failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    return res.status(200).json({ message: 'Poll updated successfully' });
  });
});


function generateToken() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post('/generate-tokens', async (req, res) => {
  const { pollId, tokenQuantity } = req.body;

  if (!pollId || !tokenQuantity || isNaN(tokenQuantity) || tokenQuantity <= 0) {
    return res.status(400).json({ error: 'Invalid pollId or tokenQuantity' });
  }

  try {
    connection.query('SELECT token FROM vote_tokens', (err, results) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      const existingTokens = new Set(results.map(r => r.token));
      const newTokens = new Set();

      while (newTokens.size < tokenQuantity) {
        const token = generateToken();
        if (!existingTokens.has(token) && !newTokens.has(token)) {
          newTokens.add(token);
        }
      }

      const insertValues = Array.from(newTokens).map(token => [token, pollId]);

      const insertQuery = 'INSERT INTO vote_tokens (token, poll_id) VALUES ?';
      connection.query(insertQuery, [insertValues], (insertErr) => {
        if (insertErr) {
          console.error('Insert error:', insertErr);
          return res.status(500).json({ error: 'Failed to insert tokens' });
        }

        res.status(201).json({ success: true, tokens: Array.from(newTokens), pollId: pollId });
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ error: 'Unexpected server error' });
  }
});


app.listen(port, () => {
  console.log(`Polls API listening on port ${port}`)
})

