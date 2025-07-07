const express = require('express');
const path = require('path');
const app = express();
const port = 80;

app.use(express.static(path.join(__dirname, 'src'))); // 假设静态资源放在 public 目录

app.listen(port, () => {
  console.log(`服务已启动: http://localhost:${port}`);
});
