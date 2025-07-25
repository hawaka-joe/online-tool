const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const router = express();

const tmpDir = path.join(__dirname, 'tmp');

// 存储进度信息的 Map
const progressMap = new Map();

// 文件上传配置
const upload = multer({
    dest: tmpDir
});

// 进度管理函数
function updateProgress(progressId, stage, message, percentage) {
    const progress = {
        id: progressId,
        stage,
        message,
        percentage: Math.min(100, Math.max(0, percentage)),
        timestamp: new Date().toISOString()
    };
    
    progressMap.set(progressId, progress);
    console.log(`[进度更新] ${progressId}: ${percentage}% - ${message}`);
    
    // 如果有 SSE 连接，发送进度更新
    const connections = progressMap.get(`${progressId}_connections`) || [];
    connections.forEach(res => {
        if (!res.finished) {
            res.write(`data: ${JSON.stringify(progress)}\n\n`);
        }
    });
}

// SSE 端点 - 获取实时进度
router.get('/progress/:progressId', (req, res) => {
    const progressId = req.params.progressId;
    
    // 设置 SSE 响应头
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // 发送连接建立消息
    res.write(`data: ${JSON.stringify({
        id: progressId,
        stage: 'connected',
        message: '连接已建立',
        percentage: 0,
        timestamp: new Date().toISOString()
    })}\n\n`);

    // 保存连接以便后续发送进度更新
    const connectionsKey = `${progressId}_connections`;
    const connections = progressMap.get(connectionsKey) || [];
    connections.push(res);
    progressMap.set(connectionsKey, connections);

    // 如果已有进度信息，立即发送
    const currentProgress = progressMap.get(progressId);
    if (currentProgress) {
        res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
    }

    // 处理连接关闭
    req.on('close', () => {
        const connections = progressMap.get(connectionsKey) || [];
        const index = connections.indexOf(res);
        if (index !== -1) {
            connections.splice(index, 1);
            progressMap.set(connectionsKey, connections);
        }
        console.log(`[SSE] 客户端断开连接: ${progressId}`);
    });
});

/**
 * 从 URL 中提取图片扩展名
 * 用于判断是否替换单元格内容
 */
function getImageExtensionFromUrl(imageUrl) {
    try {
        const parsed = new URL(imageUrl);
        const ext = path.extname(parsed.pathname).toLowerCase().replace('.', '');
        const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        return validExts.includes(ext) ? ext : null;
    } catch (e) {
        return null;
    }
}

// 下载图片，增加重试和日志
async function downloadImageBuffer(url, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            console.log(`[下载图片] 尝试第${attempt + 1}次: ${url}`);
            const response = await axios.get(url, {
                responseType: 'arraybuffer'
            });
            console.log(`[下载图片] 成功: ${url}`);
            return {
                url,
                buffer: Buffer.from(response.data, 'binary'),
                success: true
            };
        } catch (err) {
            attempt++;
            console.warn(`[下载图片] 失败: ${url}，第${attempt}次，错误: ${err.message}`);
            if (attempt >= maxRetries) {
                return {
                    url,
                    buffer: null,
                    success: false,
                    error: err.message
                };
            }
            // 可选：等待一段时间再重试
            await new Promise(res => setTimeout(res, 500));
        }
    }
}

// 处理 Excel 并嵌入图片
async function processExcelWithImages(inputFilePath, progressId) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputFilePath);

    // 更新进度：文件读取完成
    updateProgress(progressId, 'reading', '文件读取完成', 10);

    const imageTasks = [];
    const imageCellMap = new Map();

    // 扫描所有图片链接
    for (const worksheet of workbook.worksheets) {
        for (let row of worksheet._rows) {
            if (!row) continue;

            for (let cell of row._cells) {
                const cellValue = cell.value?.text ?? cell.value;
                if (!cell || typeof cellValue !== 'string')
                    continue;

                if (cellValue.startsWith('http')) {
                    const ext = getImageExtensionFromUrl(cellValue);
                    if (!ext) continue;

                    const cellMapValue = imageCellMap.get(cellValue);
                    if (cellMapValue) {
                        cellMapValue.push({
                            worksheet,
                            cell,
                            ext
                        });
                    }
                    else {
                        imageCellMap.set(cellValue, [{
                            worksheet,
                            cell,
                            ext
                        }]);
                    }
                    
                    imageTasks.push(cellValue);
                }
            }
        }
    }

    // 更新进度：扫描完成
    updateProgress(progressId, 'scanning', `发现 ${imageTasks.length} 个图片链接`, 20);

    if (imageTasks.length === 0) {
        updateProgress(progressId, 'complete', '没有发现图片链接，处理完成', 100);
        const tempOutput = path.join(tmpDir, `output_${Date.now()}.xlsx`);
        await workbook.xlsx.writeFile(tempOutput);
        return tempOutput;
    }

    const downloadResults = [];
    const concurrencyLimit = 10;
    let completedDownloads = 0;

    // 分批下载图片
    for (let i = 0; i < imageTasks.length; i += concurrencyLimit) {
        const batch = imageTasks.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(
            batch.map(async (url) => {
                const result = await downloadImageBuffer(url);
                completedDownloads++;
                const downloadProgress = Math.floor((completedDownloads / imageTasks.length) * 50) + 20; // 20-70%
                updateProgress(progressId, 'downloading', `下载图片中 ${completedDownloads}/${imageTasks.length}`, downloadProgress);
                return result;
            })
        );
        downloadResults.push(...batchResults);
    }

    // 更新进度：下载完成
    updateProgress(progressId, 'downloaded', '图片下载完成，开始嵌入', 75);

    let processedImages = 0;
    let totalImagesToProcess = 0;

    // 计算总共需要处理的图片数量
    for (const result of downloadResults) {
        if (result.success) {
            const cellInfoArr = imageCellMap.get(result.url);
            if (cellInfoArr) {
                totalImagesToProcess += cellInfoArr.length;
            }
        }
    }

    // 嵌入图片
    for (const result of downloadResults) {
        if (!result.success) continue;

        const cellInfoArr = imageCellMap.get(result.url);
        if (!cellInfoArr) continue;

        for (const cellInfo of cellInfoArr) {
            const {
                worksheet,
                cell,
                ext
            } = cellInfo;
            try {
                const imageId = workbook.addImage({
                    buffer: result.buffer,
                    extension: ext
                });

                const {
                    row: rowIndex,
                    col: colIndex
                } = cell;
                worksheet.addImage(imageId, {
                    tl: {
                        col: colIndex - 1,
                        row: rowIndex - 1
                    },
                    ext: {
                        width: 100,
                        height: 100
                    },
                    editAs: 'oneCell'
                });

                cell.value = null;
                processedImages++;
                
                // 更新嵌入进度 75-90%
                const embedProgress = Math.floor((processedImages / totalImagesToProcess) * 15) + 75;
                updateProgress(progressId, 'embedding', `嵌入图片中 ${processedImages}/${totalImagesToProcess}`, embedProgress);
                
            } catch (err) {
                console.error(`图片嵌入失败: ${result.url}`, err.message);
                processedImages++;
            }
        }
    }

    // 更新进度：保存文件
    updateProgress(progressId, 'saving', '保存文件中...', 95);

    const tempOutput = path.join(tmpDir, `output_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(tempOutput);
    
    // 更新进度：完成
    updateProgress(progressId, 'complete', '处理完成！', 100);
    
    return tempOutput;
}

router.post('/upload', upload.single('excel'), async (req, res) => {
    // 生成唯一的进度 ID
    const progressId = `excel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const filePath = req.file.path;
        
        // 立即返回进度 ID，让前端开始监听进度
        res.json({
            success: true,
            progressId: progressId,
            message: '文件上传成功，开始处理...'
        });

        // 异步处理文件，更新进度
        updateProgress(progressId, 'uploaded', '文件上传成功，开始处理...', 5);
        
        const resultFilePath = await processExcelWithImages(filePath, progressId);

        // 处理完成后，将结果文件路径存储，供下载使用
        progressMap.set(`${progressId}_result`, resultFilePath);
        progressMap.set(`${progressId}_originalFile`, filePath);

        // 清理进度连接（延迟清理，给前端时间接收完成消息）
        setTimeout(() => {
            const connectionsKey = `${progressId}_connections`;
            const connections = progressMap.get(connectionsKey) || [];
            connections.forEach(connection => {
                if (!connection.finished) {
                    connection.end();
                }
            });
            progressMap.delete(connectionsKey);
        }, 5000);

    } catch (err) {
        console.error('处理失败:', err);
        updateProgress(progressId, 'error', `处理失败: ${err.message}`, 0);
        
        // 清理上传的文件
        if (req.file?.path) {
            fs.unlink(req.file.path, unlinkErr => {
                if (unlinkErr) console.warn('删除上传文件失败:', unlinkErr.message);
            });
        }
    }
});

// 下载处理后的文件
router.get('/download/:progressId', (req, res) => {
    const progressId = req.params.progressId;
    const resultFilePath = progressMap.get(`${progressId}_result`);
    const originalFilePath = progressMap.get(`${progressId}_originalFile`);
    
    if (!resultFilePath || !fs.existsSync(resultFilePath)) {
        return res.status(404).json({
            success: false,
            message: '文件不存在或已过期'
        });
    }

    // 设置响应头
    res.setHeader('Content-Disposition', 'attachment; filename="output_with_images.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // 发送处理后的 Excel 文件
    res.sendFile(resultFilePath, err => {
        // 清理临时文件
        if (originalFilePath) {
            fs.unlink(originalFilePath, unlinkErr => {
                if (unlinkErr) console.warn('删除上传文件失败:', unlinkErr.message);
            });
        }
        
        fs.unlink(resultFilePath, unlinkErr => {
            if (unlinkErr) console.warn('删除生成文件失败:', unlinkErr.message);
        });

        // 清理进度数据
        progressMap.delete(progressId);
        progressMap.delete(`${progressId}_result`);
        progressMap.delete(`${progressId}_originalFile`);

        if (err) {
            console.error('发送文件失败:', err.message);
            if (!res.headersSent) {
                res.status(500).send('文件发送失败');
            }
        }
    });
});

module.exports = router;


