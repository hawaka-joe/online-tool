const express = require('express');
const cors = require('cors');
const excelRouter = require('./router/excelImage.cjs');

const port = 80;

const app = express();

app.use(cors());

// 启动服务
app.listen(port, () => {
    console.log(`service running on: http://localhost:${port}`);
});

app.use('/excel', excelRouter);