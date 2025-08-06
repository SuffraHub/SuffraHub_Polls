const express = require('express')
const app = express()
const port = 8005

const cors = require('cors');

require('dotenv').config();
const mysql = require('mysql');

app.use(cors({
  origin: 'http://localhost:5173', // lub inny frontend origin
  credentials: true,
}));
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

function toDateTimeLocalString(date) {
  const d = new Date(date);
  const pad = (n) => n.toString().padStart(2, "0");

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

app.get('/poll-by-id/:id', (req, res) => {
  const { id } = req.params;

  connection.query(
    'SELECT * FROM polls WHERE id = ?',
    [id],
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Poll not found' });
      }

      const poll = results[0];
      poll.valid_to = toDateTimeLocalString(poll.valid_to);

      res.json({ pollData: poll });
    }
  );
});


app.get('/poll-by-company/:company_id', (req, res) => {
  const { company_id } = req.params;

  connection.query(
    'SELECT id, name, is_active, valid_to FROM polls WHERE company_id = ? ORDER BY valid_to DESC',
    [company_id],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!results || results.length === 0) {
        return res.status(404).json({ error: 'No polls found for this company' });
      }

      res.json({ pollData: results });
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


app.put('/editPoll', (req, res) => {
  const { pollId, name, description, is_active, owner_id, company_id, valid_to } = req.body;

  // Walidacja
  if (
    !pollId ||
    !name ||
    !description ||
    is_active === undefined ||
    !valid_to
  ) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const query = `
    UPDATE polls
    SET name = ?, description = ?, is_active = ?, valid_to = ?
    WHERE id = ?
  `;

  const values = [name, description, is_active, valid_to, pollId];

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

app.get('/tokens-by-poll/:pollId', (req, res) => {
  const { pollId } = req.params;

  const query = `
    SELECT polls.name AS poll_name, token, used, used_at, generated_at
    FROM vote_tokens
    JOIN polls ON polls.id = vote_tokens.poll_id
    WHERE poll_id = ?
  `;

  connection.query(query, [pollId], (err, results) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'No tokens found for this poll' });
    }  

    const pollName = results[0].poll_name;
    const tokens = results.map(row => ({
      token: row.token,
      used: row.used === 1,
      used_at: row.used_at,
      generated_at: row.generated_at,
    }));

    res.json({ pollId, pollName, tokens });
  });
});

app.get('/poll-report/:poll_id/:company_id', (req, res) => {
  const { poll_id, company_id } = req.params;

  if (!company_id) {
    return res.status(400).json({ error: 'Missing company_id' });
  }

  connection.query(
    'SELECT id, name, description, valid_to, company_id FROM polls WHERE id = ?',
    [poll_id],
    (err, pollResults) => {
      if (err) {
        console.error('DB error fetching poll:', err);
        return res.status(500).json({ error: 'Database error 1' });
      }

      if (pollResults.length === 0) {
        return res.status(404).json({ error: 'Poll not found' });
      }

      const poll = pollResults[0];

      if (poll.company_id != company_id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Pobierz pytania do ankiety
      connection.query(
        `SELECT pq.id AS question_poll_id, q.question AS question_name
         FROM poll_questions pq
         JOIN questions q ON pq.question_id = q.id
         WHERE pq.poll_id = ?`,
        [poll_id],
        (err, questionResults) => {
          if (err) {
            console.error('DB error fetching poll questions:', err);
            return res.status(500).json({ error: 'Database error 2', details: err.message });
          }

          if (questionResults.length === 0) {
            return res.json({ poll, questions: [] });
          }

          const questionIds = questionResults.map(q => q.question_poll_id);

          // Pobierz opcje przypisane do pytań przez questions_options
          connection.query(
            `SELECT 
                o.id AS option_id, 
                o.label, 
                qo.question_id, 
                pq.id AS question_poll_id
             FROM options o
             JOIN questions_options qo ON qo.option_id = o.id
             JOIN poll_questions pq ON pq.question_id = qo.question_id
             WHERE pq.id IN (?)`,
            [questionIds],
            (err, optionsResults) => {
              if (err) {
                console.error('DB error fetching options:', err);
                return res.status(500).json({ error: 'Database error fetching options' });
              }

              console.log('Options results:', optionsResults);

              // Pobierz liczbę głosów na każdą opcję dla pytań
              connection.query(
                `SELECT v.question_poll_id, v.option_id, COUNT(*) AS vote_count
                 FROM votes v
                 WHERE v.question_poll_id IN (?)
                 GROUP BY v.question_poll_id, v.option_id`,
                [questionIds],
                (err, voteResults) => {
                  if (err) {
                    console.error('DB error fetching votes:', err);
                    return res.status(500).json({ error: 'Database error fetching votes' });
                  }

                  console.log('Vote results:', voteResults);

                  // Mapowanie głosów: votesMap[question_poll_id][option_id] = vote_count
                  const votesMap = {};
                  voteResults.forEach(vote => {
                    if (!votesMap[vote.question_poll_id]) votesMap[vote.question_poll_id] = {};
                    votesMap[vote.question_poll_id][vote.option_id] = vote.vote_count;
                  });

                  // Grupowanie odpowiedzi per pytanie
                  const grouped = questionResults.map(q => {
                    const optionsForQuestion = optionsResults.filter(o => o.question_poll_id === q.question_poll_id);

                    const totalVotes = optionsForQuestion.reduce((sum, option) => {
                      const count = votesMap[q.question_poll_id]?.[option.option_id] || 0;
                      return sum + count;
                    }, 0);

                    const results = optionsForQuestion.map(option => ({
                      label: option.label,
                      count: votesMap[q.question_poll_id]?.[option.option_id] || 0,
                      percentage: totalVotes > 0 ? Math.round(((votesMap[q.question_poll_id]?.[option.option_id] || 0) / totalVotes) * 100) : 0
                    }));

                    return {
                      question: q.question_name,
                      results,
                      totalVotes
                    };
                  });

                  return res.json({ poll, questions: grouped });
                }
              );
            }
          );
        }
      );
    }
  );
});







app.listen(port, () => {
  console.log(`Polls API listening on port ${port}`)
})

