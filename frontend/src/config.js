// 环境配置文件
const config = {
    // 开发环境
    development: {
        apiBaseUrl: 'http://localhost:3000',
        excelUploadUrl: '/excel/upload'
    },
    // 测试环境
    testing: {
        apiBaseUrl: 'http://test-server.example.com',
        excelUploadUrl: '/excel/upload'
    },
    // 生产环境
    production: {
        apiBaseUrl: 'http://120.26.1.6:80',
        excelUploadUrl: '/excel/upload'
    }
};

// 获取当前环境
function getCurrentEnvironment() {
    // 可以通过多种方式判断当前环境：
    
    // 方式1: 通过 URL 主机名判断
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'development';
    } else if (hostname.includes('test')) {
        return 'testing';
    } else {
        return 'production';
    }
    
    // 方式2: 通过环境变量（如果使用构建工具）
    // return process.env.NODE_ENV || 'development';
    
    // 方式3: 通过 URL 参数
    // const urlParams = new URLSearchParams(window.location.search);
    // return urlParams.get('env') || 'production';
}

// 获取当前环境的配置
function getConfig() {
    const env = getCurrentEnvironment();
    return config[env];
}

// 获取完整的 API URL
function getApiUrl(endpoint) {
    const currentConfig = getConfig();
    return currentConfig.apiBaseUrl + currentConfig.excelUploadUrl;
}

// 导出配置
window.AppConfig = {
    getConfig,
    getApiUrl,
    getCurrentEnvironment
};
