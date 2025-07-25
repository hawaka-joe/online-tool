// 高级环境配置管理器
class EnvironmentManager {
    constructor() {
        this.environments = {
            development: {
                name: '开发环境',
                apiBaseUrl: 'http://localhost:3000',
                debug: true,
                timeout: 30000
            },
            testing: {
                name: '测试环境', 
                apiBaseUrl: 'http://test-server.example.com',
                debug: true,
                timeout: 15000
            },
            staging: {
                name: '预发布环境',
                apiBaseUrl: 'http://staging-server.example.com',
                debug: false,
                timeout: 10000
            },
            production: {
                name: '生产环境',
                apiBaseUrl: 'http://120.26.1.6:80',
                debug: false,
                timeout: 10000
            }
        };
        
        this.currentEnv = this.detectEnvironment();
    }
    
    // 自动检测当前环境
    detectEnvironment() {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const port = window.location.port;
        
        // 本地开发环境
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'development';
        }
        
        // 测试环境 - 根据域名包含 test 关键字
        if (hostname.includes('test')) {
            return 'testing';
        }
        
        // 预发布环境 - 根据域名包含 staging 关键字
        if (hostname.includes('staging')) {
            return 'staging';
        }
        
        // 默认为生产环境
        return 'production';
    }
    
    // 手动设置环境（用于调试）
    setEnvironment(env) {
        if (this.environments[env]) {
            this.currentEnv = env;
            console.log(`环境已切换到: ${this.environments[env].name}`);
        } else {
            console.error(`未知环境: ${env}`);
        }
    }
    
    // 获取当前环境配置
    getConfig() {
        return this.environments[this.currentEnv];
    }
    
    // 获取当前环境名称
    getCurrentEnvironment() {
        return this.currentEnv;
    }
    
    // 构建完整的 API URL
    buildApiUrl(endpoint) {
        const config = this.getConfig();
        return `${config.apiBaseUrl}${endpoint}`;
    }
    
    // 获取特定的 API 端点
    getExcelUploadUrl() {
        return this.buildApiUrl('/excel/upload');
    }
    
    // 记录当前环境信息
    logEnvironmentInfo() {
        const config = this.getConfig();
        console.group('🌍 环境信息');
        console.log('环境名称:', config.name);
        console.log('当前环境:', this.currentEnv);
        console.log('API基础地址:', config.apiBaseUrl);
        console.log('调试模式:', config.debug);
        console.log('请求超时:', config.timeout + 'ms');
        console.groupEnd();
    }
    
    // 创建带有环境配置的 fetch 请求
    async fetch(endpoint, options = {}) {
        const config = this.getConfig();
        const url = this.buildApiUrl(endpoint);
        
        // 默认配置
        const defaultOptions = {
            timeout: config.timeout,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };
        
        // 合并选项
        const fetchOptions = { ...defaultOptions, ...options };
        
        if (config.debug) {
            console.log('🚀 API请求:', url, fetchOptions);
        }
        
        try {
            const response = await fetch(url, fetchOptions);
            
            if (config.debug) {
                console.log('✅ API响应:', response.status, response.statusText);
            }
            
            return response;
        } catch (error) {
            if (config.debug) {
                console.error('❌ API请求失败:', error);
            }
            throw error;
        }
    }
}

// 创建全局实例
window.EnvManager = new EnvironmentManager();

// 在控制台显示环境信息
window.EnvManager.logEnvironmentInfo();

// 为调试提供全局方法
window.switchEnv = (env) => window.EnvManager.setEnvironment(env);
