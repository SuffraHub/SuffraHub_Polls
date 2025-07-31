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

app.listen(port, () => {
  console.log(`Polls API listening on port ${port}`)
})

