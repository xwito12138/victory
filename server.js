const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors()); // 允许跨域
app.use(bodyParser.json({ limit: '10mb' }));

const API_KEY = 'YXeYRI03cQTRJjaGAB7xqkw0';
const SECRET_KEY = '5zukkLq7WteCLSQZWi46pzl9XkFWr2NV';
let accessToken = null;
let tokenExpireTime = 0;

// 获取百度云 Access Token
async function getAccessToken() {
    const now = Date.now();
    if (accessToken && now < tokenExpireTime) return accessToken;

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', API_KEY);
    params.append('client_secret', SECRET_KEY);

    const response = await fetch('https://aip.baidubce.com/oauth/2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });

    const data = await response.json();
    if (!data.access_token) {
        throw new Error('无法获取 access_token: ' + JSON.stringify(data));
    }

    accessToken = data.access_token;
    tokenExpireTime = now + data.expires_in * 1000 - 60 * 1000; // 提前1分钟过期
    return accessToken;
}

// 提供 POST 接口：前端上传 base64 图片，后端请求百度 API
app.post('/detect-face', async (req, res) => {
    try {
        const imageBase64 = req.body.image;
        if (!imageBase64) {
            return res.status(400).json({ error: '缺少 image 参数' });
        }

        const token = await getAccessToken();

        const result = await fetch(`https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${token}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                image: imageBase64,
                image_type: 'BASE64',
                face_field: 'age,beauty,expression,emotion,gender,rotation_angle'
            }),
        });

        const data = await result.json();
        res.json(data);
    } catch (error) {
        console.error('人脸识别失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ 服务器运行中：http://localhost:${PORT}`);
}); 