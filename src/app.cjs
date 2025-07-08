const express = require('express');
const cors = require('cors');
const excelRouter = require('./router/excelImage.cjs');
const path = require('path');

const port = 80;

const app = express();

app.use(cors());

app.use(express.static(path.join(__dirname, '../frontend/src')));

app.listen(port, () => {
    console.log(`service running on: http://localhost:${port}`);
});

app.use('/excel', excelRouter);