const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const router = express();

const tmpDir = path.join(__dirname, 'tmp');

// 文件上传配置
const upload = multer({
    dest: tmpDir
});

// 从 URL 中提取图片扩展名
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
async function processExcelWithImages(inputFilePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputFilePath);

    const imageTasks = [];
    const imageCellMap = new Map();

    for (const worksheet of workbook.worksheets) {
        for (let row of worksheet._rows) {
            if (!row) continue;

            for (let cell of row._cells) {
                if (!cell || typeof cell.value !== 'string') continue;

                const cellValue = cell.value;
                if (cellValue.startsWith('http')) {
                    const ext = getImageExtensionFromUrl(cellValue);
                    if (!ext) continue;

                    imageCellMap.set(cellValue, {
                        worksheet,
                        cell,
                        ext
                    });
                    imageTasks.push(cellValue);
                }
            }
        }
    }

    const downloadResults = [];
    const concurrencyLimit = 10;

    for (let i = 0; i < imageTasks.length; i += concurrencyLimit) {
        const batch = imageTasks.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(batch.map(url => downloadImageBuffer(url)));
        downloadResults.push(...batchResults);
    }

    for (const result of downloadResults) {
        if (!result.success) continue;

        const cellInfo = imageCellMap.get(result.url);
        if (!cellInfo) continue;

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
        } catch (err) {
            console.error(`图片嵌入失败: ${result.url}`, err.message);
        }
    }

    const tempOutput = path.join(tmpDir, `output_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(tempOutput);
    return tempOutput;
}

router.post('/upload', upload.single('excel'), async (req, res) => {
    try {
        const filePath = req.file.path;
        const resultFilePath = await processExcelWithImages(filePath);

        // 设置响应头
        res.setHeader('Content-Disposition', 'attachment; filename="output_with_images.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // 发送处理后的 Excel 文件
        res.sendFile(resultFilePath, err => {
            // 清理临时文件
            fs.unlink(filePath, unlinkErr => {
                if (unlinkErr) console.warn('删除上传文件失败:', unlinkErr.message);
            });
            fs.unlink(resultFilePath, unlinkErr => {
                if (unlinkErr) console.warn('删除生成文件失败:', unlinkErr.message);
            });

            if (err) {
                console.error('发送文件失败:', err.message);
                if (!res.headersSent) {
                    res.status(500).send('文件发送失败');
                }
            }
        });

    } catch (err) {
        console.error('处理失败:', err);
        res.status(500).send('处理文件时发生错误');
    }
});

module.exports = router;


