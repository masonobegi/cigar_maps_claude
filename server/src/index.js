const express = require('express');
const cors = require('cors');
const { initSchema } = require('./database/schema');

const app = express();
app.use(cors());
app.use(express.json());

initSchema();

app.use('/api/auth', require('./routes/auth'));
app.use('/api/cigars', require('./routes/cigars'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/users', require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/deals', require('./routes/deals'));
app.use('/api/smoke-list', require('./routes/smoke-list'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (_, res) => res.json({ status: 'ok', app: 'CigarBuddy' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CigarBuddy API running on :${PORT}`));
