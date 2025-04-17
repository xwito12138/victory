const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// 启用CORS
app.use(cors({
    origin: '*', // 允许所有来源
    methods: ['GET', 'POST'], // 允许的HTTP方法
    allowedHeaders: ['Content-Type'] // 允许的请求头
}));

// 解析JSON请求体
app.use(express.json({ limit: '50mb' }));

// 百度云API配置
const API_KEY = 'YXeYRI03cQTRJjaGAB7xqkw0';
const SECRET_KEY = '5zukkLq7WteCLSQZWi46pzl9XkFWr2NV';
const ACCESS_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const FACE_DETECT_URL = 'https://aip.baidubce.com/rest/2.0/face/v3/detect';

// 获取access token
async function getAccessToken() {
    try {
        console.log('Requesting access token from Baidu...');
        const response = await fetch(ACCESS_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`
        });
        
        console.log('Access token response status:', response.status);
        const data = await response.json();
        console.log('Access token response:', data);
        
        if (!data.access_token) {
            throw new Error('Failed to get access token: ' + JSON.stringify(data));
        }
        return data.access_token;
    } catch (error) {
        console.error('Error getting access token:', error);
        throw error;
    }
}

let accessToken = null;
let tokenExpireTime = 0;

// 确保有有效的access token
async function ensureAccessToken() {
    const now = Date.now();
    if (!accessToken || now >= tokenExpireTime) {
        console.log('Getting new access token...');
        accessToken = await getAccessToken();
        tokenExpireTime = now + 29 * 24 * 60 * 60 * 1000; // 29天过期
        console.log('New access token received:', accessToken);
    }
    return accessToken;
}

// 添加请求日志中间件
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.post('/face-detect', async (req, res) => {
    try {
        console.log('Received face detection request');
        console.log('Request body size:', req.body.image_base64 ? req.body.image_base64.length : 0);
        
        if (!req.body.image_base64) {
            throw new Error('No image data provided');
        }

        const token = await ensureAccessToken();
        console.log('Using access token:', token);

        const requestBody = {
            image: req.body.image_base64,
            image_type: 'BASE64',
            face_field: 'rotation_angle'
        };

        console.log('Sending request to Baidu API...');
        const response = await fetch(`${FACE_DETECT_URL}?access_token=${token}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('Baidu API response status:', response.status);
        const responseText = await response.text();
        console.log('Baidu API response text:', responseText);

        if (!response.ok) {
            throw new Error(`Baidu API responded with status ${response.status}: ${responseText}`);
        }

        const data = JSON.parse(responseText);
        console.log('Baidu API response parsed:', data);
        res.json(data);
    } catch (error) {
        console.error('Error in face detection:', error);
        res.status(500).json({ 
            error: error.message,
            details: error.stack
        });
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        details: err.message
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log('CORS enabled for all origins');
    console.log('Server is ready to accept requests');
}); 