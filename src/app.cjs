const express = require('express');
const cors = require('cors');
const excelRouter = require('./router/excelImage.cjs');
const path = require('path');

const port = 80;

const app = express();

app.use(cors());

app.use(express.static(path.join(__dirname, '../frontend/src'))); // 假设静态资源放在 public 目录

// 启动服务
app.listen(port, () => {
    console.log(`service running on: http://localhost:${port}`);
});

app.use('/excel', excelRouter);